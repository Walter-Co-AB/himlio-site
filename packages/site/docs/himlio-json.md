# `himlio.json`

The platform facts of a site: the contract between the platform, which writes the file, and
`@himlio/site`, which reads it. Terraform in `Walter-Co-AB/himlio-infrastructure`
(`modules/customer/main.tf`) commits it to the site's repo and overwrites it on every apply, so
nobody edits it by hand. The starter has a placeholder for local development.

```json
{
  "slug": "example",
  "name": "Example AB",
  "locale": "sv",
  "url": "https://example.se",
  "email": { "from": "noreply@example.se", "reply_to": "info@example.se" },
  "forms": { "notify": ["info@example.se"] },
  "turnstile": { "site_key": "0x4AAAAAAA..." },
  "analytics": { "cloudflare_token": "0123456789abcdef0123456789abcdef" }
}
```

| Key                          | What                                                                                                                                           | Absent or `null`                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `slug`                       | The site's id on the platform. Gives the dev port and `HIMLIO_SLUG`.                                                                           | `""`                                   |
| `name`                       | The business name: the sender name of emails, and the site title where the admin has none.                                                     | `""`                                   |
| `locale`                     | The site's language (`sv`, `en`): visitor text, URLs (`/nyheter`, `/integritetspolicy`), the privacy policy and validation messages.           | `en`                                   |
| `url`                        | The public address, `https://` and no trailing slash: Astro's `site` (canonical URLs, sitemap), the feed, the business info and booking links. | The request's own address              |
| `email.from`                 | The platform's sender. With it, the build adds EmDash's email provider (the `EMAIL` binding).                                                  | No email; invites give a link to share |
| `email.reply_to`             | Where replies to the site's emails go.                                                                                                         | No Reply-To                            |
| `forms.notify`               | Default recipients of form notifications, for forms without their own.                                                                         | No default recipients                  |
| `turnstile.site_key`         | Cloudflare Turnstile's public key. The site uses Turnstile (booking) only when the Worker also has the secret `TURNSTILE_SECRET`.              | No Turnstile                           |
| `analytics.cloudflare_token` | Cloudflare Web Analytics' beacon token: the cookieless statistics on every public page, and the privacy policy mentions them.                  | No statistics                          |

Rules for changing the contract:

- **Unknown keys are ignored**, so the platform can add a key before the sites have a
  `@himlio/site` that reads it. Add the key in infrastructure first, then read it here.
- **A present but invalid value fails the build** with a message naming the key (a malformed
  address, token or key), so a mistake never reaches a live site.
- **Removing or renaming a key, or changing what a value means, is a breaking change** for
  every site on an older version: a major version here, and a migration plan with
  infrastructure.
