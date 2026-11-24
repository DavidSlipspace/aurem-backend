// Shared, dependency-free HTML for Orvo transactional emails.
// Escape dynamic values before interpolating them into bodyHtml.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function emailButton(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td bgcolor="#13294B" style="background:#13294B;border-radius:8px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 18px;color:#172b46;font-size:16px;line-height:1.6;">${html}</p>`;
}

export function emailDetail(label: string, value: string, detail?: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f4f7fb;border:1px solid #dce4ee;border-radius:8px;"><tr><td style="padding:16px;">
    <p style="margin:0 0 6px;color:#62748a;font-size:12px;font-weight:bold;text-transform:uppercase;">${escapeHtml(label)}</p>
    <p style="margin:0;color:#172b46;font-size:16px;font-weight:bold;">${escapeHtml(value)}</p>
    ${detail ? `<p style="margin:8px 0 0;color:#62748a;font-size:14px;">${escapeHtml(detail)}</p>` : ""}
  </td></tr></table>`;
}

export function emailLayout(input: { category: string; title: string; bodyHtml: string; notice?: string }): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(input.title)}</title></head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172b46;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f4f7fb"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:600px;border:1px solid #dce4ee;border-radius:12px;">
  <tr><td bgcolor="#13294B" style="padding:24px;background:#13294B;color:#ffffff;font-size:30px;font-weight:bold;border-bottom:4px solid #5B8FD9;border-radius:11px 11px 0 0;">Orvo</td></tr>
  <tr><td style="padding:28px 24px;">
  <p style="margin:0 0 10px;color:#62748a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(input.category)}</p>
  <h1 style="margin:0 0 20px;color:#172b46;font-size:26px;line-height:1.25;">${escapeHtml(input.title)}</h1>
  ${input.bodyHtml}
  </td></tr><tr><td bgcolor="#f4f7fb" style="padding:20px 24px;border-top:1px solid #dce4ee;color:#62748a;font-size:13px;line-height:1.6;">
  ${input.notice ? `<p style="margin:0 0 12px;">${escapeHtml(input.notice)}</p>` : ""}<p style="margin:0;font-weight:bold;">Orvo Travel</p>
  </td></tr></table></td></tr></table></body></html>`;
}
