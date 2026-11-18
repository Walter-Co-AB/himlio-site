// Guidance for AI connectors (MCP clients such as Claude), sent as the `instructions` of the MCP
// `initialize` result, which clients read when they connect. EmDash 1.5 sets none and has no
// option for it, so the Worker adds them to EmDash's response.

export const MCP_INSTRUCTIONS = `This is a Himlio website, run on EmDash CMS.

- Publishing: a change to a published item is saved as a draft unless you publish it. When you change a published item with content_update, pass status: "published", or call content_publish afterwards. Otherwise the change is not visible on the site, even though the update succeeded.
- Contact details (phone, email, address, organisation number, opening hours) are the one entry in the "company" collection, slug "foretagsuppgifter". Update that entry with content_get, then content_update (pass the _rev from content_get, and status: "published"). Don't create a second entry. Empty fields are not shown on the site.
- The site's description is the Tagline in the site settings. You can read it (settings_get) but not change it; the customer changes it in the admin under Settings → General.
- Pages are in the "pages" collection; the home page is the page with slug "home" (on older sites "start"). Read the collection with schema_get_collection before writing: on most Himlio sites a page's content is a list of sections (EmDash block types such as marketing_hero, marketing_text, marketing_faq). Use the existing block types and their fields; don't put whole pages into one text section.
- Forms (such as a contact form) are made by the customer in the admin under Forms, where the submissions are too; you can't create forms or read submissions. To show an existing form on a page, put a block { _type: "emdash-form", _key, formId: "<the form's slug>" } in the body of a text section (marketing_text), and ask the user for the slug. Forms keep submissions at most 12 months and can't send automatic replies to visitors (platform rules), so don't promise either.
- Write in Swedish unless asked otherwise, and don't invent facts, customers, numbers or testimonials.`;

function routePath(url: URL): string | null {
  try {
    return decodeURIComponent(url.pathname)
      .toLowerCase()
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '');
  } catch {
    return null;
  }
}

export const isMcpPath = (url: URL) => routePath(url) === '/_emdash/api/mcp';

/** Ids of `initialize` requests in a JSON-RPC body (a single message or a batch). */
export async function initializeIds(request: Request): Promise<Set<unknown>> {
  const ids = new Set<unknown>();
  if (request.method !== 'POST') return ids;
  try {
    const body: unknown = await request.clone().json();
    for (const message of Array.isArray(body) ? body : [body])
      if (
        message &&
        typeof message === 'object' &&
        (message as { method?: unknown }).method === 'initialize'
      )
        ids.add((message as { id?: unknown }).id);
  } catch {
    // Not JSON: EmDash answers it.
  }
  return ids;
}

function withInstructions(message: unknown, ids: Set<unknown>): unknown {
  if (!message || typeof message !== 'object') return message;
  const m = message as { id?: unknown; result?: Record<string, unknown> };
  if (
    !ids.has(m.id) ||
    !m.result ||
    typeof m.result !== 'object' ||
    !('protocolVersion' in m.result)
  )
    return message;
  const existing = typeof m.result.instructions === 'string' ? `${m.result.instructions}\n\n` : '';
  return { ...m, result: { ...m.result, instructions: existing + MCP_INSTRUCTIONS } };
}

/** Adds the instructions to the `initialize` result in EmDash's response (JSON or SSE). */
export async function addMcpInstructions(response: Response, ids: Set<unknown>): Promise<Response> {
  if (ids.size === 0 || !response.ok) return response;
  const type = response.headers.get('content-type') ?? '';
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const init = { status: response.status, statusText: response.statusText, headers };

  if (type.includes('application/json')) {
    const body: unknown = await response.json();
    const out = Array.isArray(body)
      ? body.map((m) => withInstructions(m, ids))
      : withInstructions(body, ids);
    return new Response(JSON.stringify(out), init);
  }
  if (type.includes('text/event-stream')) {
    // The initialize answer is one short event; the stateless transport closes the stream.
    const text = await response.text();
    const out = text
      .split('\n')
      .map((line) => {
        if (!line.startsWith('data:')) return line;
        try {
          return `data: ${JSON.stringify(withInstructions(JSON.parse(line.slice(5)), ids))}`;
        } catch {
          return line;
        }
      })
      .join('\n');
    return new Response(out, init);
  }
  return response;
}
