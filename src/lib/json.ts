export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers as Record<string, string> ?? {}),
    },
  });
}

export function badRequest(code: string): Response {
  return json({ error: { code } }, { status: 400 });
}

export function notFound(code: string): Response {
  return json({ error: { code } }, { status: 404 });
}

export function conflict(code: string): Response {
  return json({ error: { code } }, { status: 409 });
}

export function methodNotAllowed(): Response {
  return json({ error: { code: "method_not_allowed" } }, { status: 405 });
}
