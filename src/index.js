// Cloudflare Worker entry point (Workers with static assets).
// Handles POST /api/contact itself; everything else falls through to the
// static site in /public via the ASSETS binding.

const RECIPIENT = 'info@riverfinance.ca';

// riverfinance.ca is verified in Resend, so mail sends from a real address
// on the domain instead of the shared resend.dev testing address.
const SENDER = 'River Finance <forms@riverfinance.ca>';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleContact(request, env) {
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ ok: false, error: 'Server is not configured to send email yet.' }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Could not read form data.' }, 400);
  }

  const name = (form.get('name') || '').toString().trim();
  const business = (form.get('business') || '').toString().trim();
  const email = (form.get('email') || '').toString().trim();
  const phone = (form.get('phone') || '').toString().trim();
  const message = (form.get('message') || '').toString().trim();

  // Honeypot: hidden field real visitors never fill in. If it has a
  // value, silently pretend success so the bot moves on.
  const honeypot = (form.get('company_website') || '').toString().trim();
  if (honeypot) {
    return jsonResponse({ ok: true });
  }

  if (!name || !business || !email) {
    return jsonResponse({ ok: false, error: 'Name, business, and email are required.' }, 400);
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return jsonResponse({ ok: false, error: "That email address doesn't look right." }, 400);
  }

  const subject = `Contact form: ${business || name}`;
  const textBody =
    `Name: ${name}\n` +
    `Business: ${business}\n` +
    `Email: ${email}\n` +
    `Phone: ${phone || '(not provided)'}\n\n` +
    `Message:\n${message || '(none)'}`;

  const htmlBody = `
    <h2>New contact form submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Business:</strong> ${escapeHtml(business)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone) || '(not provided)'}</p>
    <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>') || '(none)'}</p>
  `;

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [RECIPIENT],
        reply_to: email,
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error('Resend error:', resendResponse.status, errText);
      return jsonResponse({ ok: false, error: 'The message could not be sent. Please try again.' }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Contact function error:', err);
    return jsonResponse({ ok: false, error: 'The message could not be sent. Please try again.' }, 500);
  }
}

async function handleFlinksToken(request, env) {
  if (!env.FLINKS_SECRET_KEY || !env.FLINKS_INSTANCE || !env.FLINKS_CUSTOMER_ID) {
    return jsonResponse({ ok: false, error: 'Flinks is not configured yet.' }, 500);
  }

  // Wherever Flinks Connect sends the user after they finish connecting
  // their bank account, built from whatever domain this request actually
  // came in on — so this works the same on the .workers.dev test URL and
  // on riverfinance.ca later, with no manual switch needed.
  const redirectUrl = `${new URL(request.url).origin}/bank-connected.html`;

  const tokenUrl =
    `https://${env.FLINKS_INSTANCE}-api.private.fin.ag/v3/${env.FLINKS_CUSTOMER_ID}` +
    `/BankingServices/GenerateAuthorizeToken`;

  try {
    const flinksResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'flinks-auth-key': env.FLINKS_SECRET_KEY,
      },
    });

    const raw = await flinksResponse.text();

    if (!flinksResponse.ok) {
      console.error('Flinks token error:', flinksResponse.status, raw);
      return jsonResponse({ ok: false, error: 'Could not start the bank connection. Please try again.' }, 502);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('Flinks token: unexpected response body:', raw);
      return jsonResponse({ ok: false, error: 'Unexpected response from Flinks.' }, 502);
    }

    // Field name isn't 100% confirmed from docs alone — this logs the full
    // response so we can see the real shape on the first live test.
    console.log('Flinks token response:', JSON.stringify(data));

    const token = data.Token || data.token || data.AuthorizeToken || data.authorizeToken;

    if (!token) {
      console.error('Flinks token: no recognizable token field in:', JSON.stringify(data));
      return jsonResponse({ ok: false, error: 'Could not read the token from the Flinks response.' }, 502);
    }

    const iframeUrl =
      `https://${env.FLINKS_INSTANCE}-iframe.private.fin.ag/v2/` +
      `?authorizeToken=${encodeURIComponent(token)}` +
      `&redirectUrl=${encodeURIComponent(redirectUrl)}`;

    return jsonResponse({ ok: true, iframeUrl });
  } catch (err) {
    console.error('Flinks token fetch failed:', err);
    return jsonResponse({ ok: false, error: 'Could not start the bank connection. Please try again.' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    if (url.pathname === '/api/flinks-token' && request.method === 'POST') {
      return handleFlinksToken(request, env);
    }

    // Everything else: serve the static site from /public.
    return env.ASSETS.fetch(request);
  },
};
