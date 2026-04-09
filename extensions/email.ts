import { getResend } from "./resend.js";
import { createLogger } from "../utils/logger.js";
import { getConfig } from "../config.js";

const config = getConfig();
const logger = createLogger(config);

const SPAR_DURATION_MS = 90 * 60 * 1000; // 1.5 hours
// Resend requires a verified domain. Use their test sender in dev.
const FROM_EMAIL = config.isProd
  ? "Debatium <noreply@debatium.org>"
  : "Debatium <noreply@debatium.org>";

interface SparEmailData {
  sparId: string;
  sparName: string;
  sparTime: Date;
  rule: string;
  role: string;
  motion: string | null;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function toICSDateString(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function buildCalendarLinks(spar: SparEmailData) {
  const start = spar.sparTime;
  const end = new Date(start.getTime() + SPAR_DURATION_MS);

  const title = encodeURIComponent(spar.sparName);
  const description = encodeURIComponent(
    `Debate Spar: ${spar.sparName}\nRule: ${spar.rule.toUpperCase()}\nRole: ${spar.role}${spar.motion ? `\nMotion: ${spar.motion}` : ""}`,
  );

  // Google Calendar link
  const googleStart = toICSDateString(start);
  const googleEnd = toICSDateString(end);
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${googleStart}/${googleEnd}&details=${description}`;

  // Outlook Web link
  const outlookStart = start.toISOString();
  const outlookEnd = end.toISOString();
  const outlook = `https://outlook.live.com/calendar/0/action/compose?subject=${title}&startdt=${outlookStart}&enddt=${outlookEnd}&body=${description}`;

  // ICS file content (for Apple Calendar / download)
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Debatium//Spar//EN",
    "BEGIN:VEVENT",
    `DTSTART:${googleStart}`,
    `DTEND:${googleEnd}`,
    `SUMMARY:${spar.sparName}`,
    `DESCRIPTION:Rule: ${spar.rule.toUpperCase()}\\nRole: ${spar.role}${spar.motion ? `\\nMotion: ${spar.motion}` : ""}`,
    `UID:${spar.sparId}@debatium.org`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const icsDataUri = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

  return { google, outlook, icsDataUri };
}

export async function sendSparInviteEmail(
  toEmail: string,
  inviteeName: string,
  hostName: string,
  spar: SparEmailData,
  isRegistered = true,
): Promise<void> {
  let resend: ReturnType<typeof getResend>;
  try {
    resend = getResend();
  } catch {
    logger.warn("Resend not configured — skipping invite email");
    return;
  }

  const calendarLinks = buildCalendarLinks(spar);
  const formattedTime = formatDateTime(spar.sparTime);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background:#18181b;padding:32px 32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Debatium</h1>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#27272a;font-size:16px;margin:0 0 16px;">Hi ${inviteeName},</p>
      <p style="color:#27272a;font-size:16px;margin:0 0 24px;">
        <strong>${hostName}</strong> has invited you to a debate spar!
      </p>

      <!-- Spar Details Card -->
      <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:0 0 24px;">
        <h2 style="color:#18181b;font-size:18px;margin:0 0 12px;">${spar.sparName}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="color:#71717a;font-size:14px;padding:4px 0;width:80px;">When</td>
            <td style="color:#27272a;font-size:14px;padding:4px 0;">${formattedTime}</td>
          </tr>
          <tr>
            <td style="color:#71717a;font-size:14px;padding:4px 0;">Format</td>
            <td style="color:#27272a;font-size:14px;padding:4px 0;">${spar.rule.toUpperCase()}</td>
          </tr>
          <tr>
            <td style="color:#71717a;font-size:14px;padding:4px 0;">Your Role</td>
            <td style="color:#27272a;font-size:14px;padding:4px 0;text-transform:capitalize;">${spar.role}</td>
          </tr>
          ${
            spar.motion
              ? `<tr>
            <td style="color:#71717a;font-size:14px;padding:4px 0;vertical-align:top;">Motion</td>
            <td style="color:#27272a;font-size:14px;padding:4px 0;">${spar.motion}</td>
          </tr>`
              : ""
          }
        </table>
      </div>

      <!-- Add to Calendar -->
      <p style="color:#71717a;font-size:14px;margin:0 0 12px;">Add to your calendar:</p>
      <div style="margin:0 0 24px;">
        <a href="${calendarLinks.google}" target="_blank"
           style="display:inline-block;padding:8px 16px;margin:0 8px 8px 0;background:#4285f4;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">
          Google Calendar
        </a>
        <a href="${calendarLinks.outlook}" target="_blank"
           style="display:inline-block;padding:8px 16px;margin:0 8px 8px 0;background:#0078d4;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">
          Outlook
        </a>
        <a href="${calendarLinks.icsDataUri}" download="${spar.sparName.replace(/[^a-zA-Z0-9]/g, "_")}.ics"
           style="display:inline-block;padding:8px 16px;margin:0 8px 8px 0;background:#52525b;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">
          Apple / Download .ics
        </a>
      </div>

      <!-- CTA -->
      ${
        isRegistered
          ? `<p style="color:#27272a;font-size:14px;margin:0 0 8px;">
            Open Debatium to accept or decline this invitation.
          </p>`
          : `<p style="color:#27272a;font-size:14px;margin:0 0 16px;">
            You've been invited to join a debate on Debatium. Sign up to participate!
          </p>
          <a href="https://debatium.org/register" target="_blank"
             style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            Join Debatium
          </a>`
      }
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1px solid #e4e4e7;text-align:center;">
      <p style="color:#a1a1aa;font-size:12px;margin:0;">
        ${
          isRegistered
            ? "You received this email because you have an account on Debatium."
            : "You received this email because someone invited you to a debate spar on Debatium."
        }
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `${hostName} invited you to spar: ${spar.sparName}`,
      html,
    });
    logger.info({ toEmail, sparId: spar.sparId }, "Spar invite email sent");
  } catch (err) {
    logger.error(
      { err, toEmail, sparId: spar.sparId },
      "Failed to send spar invite email",
    );
  }
}
