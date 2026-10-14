import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Metode tidak didukung." });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !anonKey || !serviceKey) return reply(500, { error: "Konfigurasi server undangan belum lengkap." });

  const authorization = req.headers.get("Authorization") ?? "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === authorization) return reply(401, { error: "Login diperlukan." });

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(jwt);
  if (authError || !authData.user) return reply(401, { error: "Sesi akun tidak valid. Silakan login ulang." });
  const caller = authData.user;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Permintaan tidak valid." }); }
  const action = String(body.action ?? "");
  const projectId = String(body.project_id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return reply(400, { error: "ID proyek tidak valid." });
  }

  const { data: project, error: projectError } = await admin
    .from("cineblock_projects").select("id,owner_id").eq("id", projectId).maybeSingle();
  if (projectError || !project) return reply(404, { error: "Proyek tidak ditemukan." });

  let isOwner = project.owner_id === caller.id;
  if (!isOwner) {
    const { data: membership } = await admin.from("cineblock_project_members")
      .select("role").eq("project_id", projectId).eq("user_id", caller.id).maybeSingle();
    isOwner = membership?.role === "owner";
  }
  if (!isOwner) return reply(403, { error: "Hanya owner proyek yang boleh mengelola undangan dan anggota." });

  if (action === "list") {
    const { data: members, error } = await admin.from("cineblock_project_members")
      .select("project_id,user_id,role,created_at").eq("project_id", projectId).order("created_at", { ascending: true });
    if (error) return reply(500, { error: "Daftar anggota tidak dapat dimuat." });
    const results = await Promise.all((members ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      return { ...member, email: data.user?.email ?? "(email tidak tersedia)" };
    }));
    const ownerEmail = await admin.auth.admin.getUserById(project.owner_id);
    if (!(members ?? []).some((member) => member.user_id === project.owner_id)) {
      results.unshift({ project_id: projectId, user_id: project.owner_id, role: "owner", email: ownerEmail.data.user?.email ?? "(owner)", created_at: null });
    }
    return reply(200, { members: results });
  }

  if (action === "remove") {
    const userId = String(body.user_id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return reply(400, { error: "ID anggota tidak valid." });
    }
    if (userId === project.owner_id || userId === caller.id) return reply(400, { error: "Owner tidak dapat dihapus dari proyek melalui tindakan ini." });
    const { error } = await admin.from("cineblock_project_members")
      .delete().eq("project_id", projectId).eq("user_id", userId).neq("role", "owner");
    if (error) return reply(500, { error: "Akses anggota tidak berhasil dicabut." });
    return reply(200, { ok: true });
  }

  if (action !== "invite") return reply(400, { error: "Tindakan tidak dikenal." });
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Masukkan alamat email yang valid." });
  if (role !== "editor" && role !== "viewer") return reply(400, { error: "Role undangan hanya boleh editor atau viewer." });
  if (caller.email?.toLowerCase() === email) return reply(400, { error: "Email owner tidak perlu diundang ke proyeknya sendiri." });

  const { data: quotaAllowed, error: quotaError } = await admin.rpc("cineblock_consume_invitation_quota", {
    p_inviter_id: caller.id,
    p_project_id: projectId,
    p_invitee_email: email,
  });
  if (quotaError) return reply(500, { error: "Batas undangan tidak dapat diverifikasi; coba lagi nanti." });
  if (quotaAllowed !== true) return reply(429, { error: "Batas keamanan tercapai: maksimal 8 percobaan undangan per jam per akun." });

  const { data: existingMembership } = await admin.from("cineblock_project_members")
    .select("user_id,role").eq("project_id", projectId);
  let targetUser: { id: string; email?: string | null } | null = null;
  let isExistingAccount = false;
  for (let page = 1; page <= 10 && !targetUser; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return reply(500, { error: "Akun tujuan tidak dapat diverifikasi." });
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) { targetUser = found; isExistingAccount = true; }
    if (data.users.length < 100) break;
  }
  if (targetUser && (existingMembership ?? []).some((member) => member.user_id === targetUser!.id)) {
    return reply(409, { error: "Akun tersebut sudah menjadi anggota proyek ini." });
  }

  if (!targetUser) {
    const redirectTo = "https://cineblock-nu.vercel.app";
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo,
      data: { cineblock_invited_project: projectId, cineblock_invited_role: role },
    });
    if (error || !data.user) return reply(502, { error: error?.message?.includes("already") ? "Email sudah terdaftar. Minta pengguna login terlebih dahulu, lalu undang kembali." : "Email undangan gagal dikirim. Periksa konfigurasi SMTP dan URL redirect Supabase." });
    targetUser = data.user;
  }

  const { error: membershipError } = await admin.from("cineblock_project_members").upsert({
    project_id: projectId, user_id: targetUser.id, role,
  }, { onConflict: "project_id,user_id" });
  if (membershipError) return reply(500, { error: "Akun ditemukan, tetapi penetapan akses gagal. Hubungi pengelola sebelum mencoba ulang." });

  return reply(200, {
    ok: true,
    email,
    role,
    existing_account: isExistingAccount,
    message: isExistingAccount
      ? "Akun yang sudah terdaftar diberi akses proyek. Pengguna dapat login menggunakan akun CineBlock miliknya."
      : "Undangan email dikirim. Pengguna harus membuka tautan undangan dan membuat kata sandi CineBlock sendiri.",
  });
});
