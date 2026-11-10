// Example Pages Function: POST /api/contact
//
// Shows the rules from AGENTS.md: Turnstile on public forms, input validation,
// parameterised SQL, secrets from env (never from git), and no internal details in errors.
//
// Needs (set up in Cloudflare by Walter & Co):
//   env.DB               D1 database binding
//   env.TURNSTILE_SECRET Turnstile secret key
// Rate limiting is configured as a Cloudflare rule on /api/*.

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
}

const MAX = { name: 200, email: 254, message: 5000 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyTurnstile(token: string, secret: string, ip: string | null) {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = (await res.json()) as { success: boolean };
  return data.success;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const field = (key: string) => String(form.get(key) ?? '').trim();

  const name = field('name');
  const email = field('email');
  const message = field('message');
  const token = field('cf-turnstile-response');

  if (
    !name ||
    !message ||
    name.length > MAX.name ||
    email.length > MAX.email ||
    message.length > MAX.message ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return json({ ok: false, error: 'Kontrollera fälten och försök igen.' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP');
  if (!token || !(await verifyTurnstile(token, env.TURNSTILE_SECRET, ip))) {
    return json({ ok: false, error: 'Verifieringen misslyckades. Försök igen.' }, 403);
  }

  try {
    // Always bind values with ?; never build SQL from strings.
    await env.DB.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)')
      .bind(name, email, message)
      .run();
  } catch (err) {
    console.error('contact: insert failed', err);
    return json({ ok: false, error: 'Något gick fel. Försök igen senare.' }, 500);
  }

  return json({ ok: true });
};
