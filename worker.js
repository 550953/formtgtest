const BUCKET_NAME = "myfiles-550953"; // если переименуешь бакет — поменяй тут

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function b2Authorize(env) {
  const resp = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: "Basic " + btoa(`${env.BACKBLAZE_KEY_ID_550953}:${env.BACKBLAZE_APP_KEY_550953}`) },
  });
  if (!resp.ok) throw new Error("B2 auth failed: " + (await resp.text()));
  return resp.json();
}

async function b2GetBucketId(auth) {
  const resp = await fetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: auth.accountId, bucketName: BUCKET_NAME }),
  });
  const data = await resp.json();
  if (!data.buckets || !data.buckets.length) throw new Error("Bucket not found: " + BUCKET_NAME);
  return data.buckets[0].bucketId;
}

async function uploadFileToB2(env, fileBlob, originalName) {
  const auth = await b2Authorize(env);
  const bucketId = await b2GetBucketId(auth);

  const uploadUrlResp = await fetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId }),
  });
  const uploadUrlData = await uploadUrlResp.json();

  const fileBuffer = await fileBlob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-1", fileBuffer);
  const sha1 = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const safeName = `screenshots/${Date.now()}-${originalName}`.replace(/[^a-zA-Z0-9._/-]/g, "_");

  const uploadResp = await fetch(uploadUrlData.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: uploadUrlData.authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(safeName),
      "Content-Type": fileBlob.type || "b2/x-auto",
      "X-Bz-Content-Sha1": sha1,
    },
    body: fileBuffer,
  });
  if (!uploadResp.ok) throw new Error("B2 upload failed: " + (await uploadResp.text()));

  // бакет приватный — генерим временный токен на скачивание (7 дней)
  const downloadAuthResp = await fetch(`${auth.apiInfo.storageApi.apiUrl}/b2api/v3/b2_get_download_authorization`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      bucketId,
      fileNamePrefix: safeName,
      validDurationInSeconds: 604800, // 7 дней
    }),
  });
  const downloadAuthData = await downloadAuthResp.json();

  const downloadHost = auth.apiInfo.storageApi.downloadUrl; // например https://f003.backblazeb2.com
  return `${downloadHost}/file/${BUCKET_NAME}/${safeName}?Authorization=${downloadAuthData.authorizationToken}`;
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) {
    return new Response(JSON.stringify({ error: "no file" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
  const url = await uploadFileToB2(env, file, file.name || "screenshot");
  return new Response(JSON.stringify({ ok: true, url }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleSubmit(request, env) {
  const data = await request.json();
  const formName = data.form || "unknown-form";
  const answers = data.answers || {};

  let text = `📋 Новая анкета: <b>${escapeHtml(formName)}</b>\n\n`;
  for (const [key, value] of Object.entries(answers)) {
    const val = Array.isArray(value) ? value.join(", ") : value;
    text += `<b>${escapeHtml(key)}:</b> ${escapeHtml(val)}\n`;
  }

  const tgResp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML" }),
  });

  if (!tgResp.ok) {
    return new Response(`Telegram error: ${await tgResp.text()}`, { status: 502, headers: corsHeaders() });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return new Response("Only POST allowed", { status: 405 });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/upload") {
        return await handleUpload(request, env);
      }
      return await handleSubmit(request, env);
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500, headers: corsHeaders() });
    }
  },
};
