import sgMail from '@sendgrid/mail';
import { storage } from './storage';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

const FALLBACK_FROM = 'noreply@cowboymedia.net';

function wrapInTemplate(bodyContent: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
<tr>
<td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:0.5px;">CowboyMedia</h1>
<p style="margin:6px 0 0;color:#94a3b8;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Service Hub</p>
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:32px 40px 24px;">
${bodyContent}
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:0 40px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="border-top:1px solid #e5e7eb;padding-top:24px;">
<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;">This is an automated notification from CowboyMedia Service Hub.</p>
<p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-align:center;">Please do not reply to this email.</p>
<p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">&copy; ${new Date().getFullYear()} CowboyMedia. All rights reserved.</p>
</td>
</tr>
</table>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function formatBodyContent(rawHtml: string): string {
  let formatted = rawHtml;

  formatted = formatted.replace(/<h2>(.*?)<\/h2>/g,
    '<h2 style="margin:0 0 16px;color:#1a1a2e;font-size:22px;font-weight:600;line-height:1.3;">$1</h2>');

  formatted = formatted.replace(/<p>(.*?)<\/p>/g,
    '<p style="margin:0 0 12px;color:#374151;font-size:15px;line-height:1.6;">$1</p>');

  formatted = formatted.replace(/<blockquote>(.*?)<\/blockquote>/g,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr><td style="border-left:4px solid #3b82f6;padding:12px 16px;background-color:#f0f7ff;border-radius:0 8px 8px 0;"><p style="margin:0;color:#374151;font-size:14px;line-height:1.6;font-style:italic;">$1</p></td></tr></table>');

  return formatted;
}

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    const styledBody = formatBodyContent(html);
    const fullHtml = wrapInTemplate(styledBody, subject);
    await client.send({
      to,
      from: fromEmail || FALLBACK_FROM,
      subject,
      html: fullHtml,
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    console.error('Failed to send email:', err);
  }
}

export async function sendEmailToMultiple(recipients: string[], subject: string, html: string) {
  for (const to of recipients) {
    await sendEmail(to, subject, html);
  }
}

function replaceVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

export async function renderTemplate(templateKey: string, variables: Record<string, string>): Promise<{ subject: string; body: string; enabled: boolean } | null> {
  try {
    const template = await storage.getEmailTemplateByKey(templateKey);
    if (!template) return null;
    return {
      subject: replaceVariables(template.subject, variables),
      body: replaceVariables(template.body, variables),
      enabled: template.enabled !== false,
    };
  } catch {
    return null;
  }
}

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    templateKey: "admin_new_signup",
    name: "New Customer Signup (Admin)",
    subject: "New Customer Signup - CowboyMedia",
    body: `<h2>New Customer Signup</h2>
<p>A new customer has registered on CowboyMedia Service Hub.</p>
<p><strong>Name:</strong> {customer_name}</p>
<p><strong>Username:</strong> {customer_username}</p>
<p><strong>Email:</strong> {customer_email}</p>`,
    availableVariables: ["customer_name", "customer_username", "customer_email"],
    description: "Sent to all admins when a new customer registers",
  },
  {
    templateKey: "admin_new_ticket",
    name: "New Support Ticket (Admin)",
    subject: "New Support Ticket: {ticket_subject}",
    body: `<h2>New Support Ticket</h2>
<p>A new support ticket has been submitted and requires your attention.</p>
<p><strong>Customer:</strong> {customer_name} (@{customer_username})</p>
<p><strong>Email:</strong> {customer_email}</p>
<p><strong>Service:</strong> {service_name}</p>
<p><strong>Subject:</strong> {ticket_subject}</p>
<p><strong>Priority:</strong> {ticket_priority}</p>
<p><strong>Description:</strong></p>
<blockquote>{ticket_description}</blockquote>`,
    availableVariables: ["customer_name", "customer_username", "customer_email", "service_name", "ticket_subject", "ticket_priority", "ticket_description"],
    description: "Sent to all admins when a customer creates a new support ticket",
  },
  {
    templateKey: "customer_ticket_received",
    name: "Ticket Received Confirmation",
    subject: "Support Ticket Received: {ticket_subject}",
    body: `<h2>We've Received Your Ticket</h2>
<p>Thank you for contacting CowboyMedia support through our ServiceHub app. We will review your support ticket and respond as quickly as possible. Thank you!</p>
<p><strong>Ticket:</strong> {ticket_subject}</p>
<p>You will receive a notification when our team responds.</p>`,
    availableVariables: ["ticket_subject", "customer_name"],
    description: "Confirmation email sent to the customer after submitting a ticket",
  },
  {
    templateKey: "admin_ticket_closed",
    name: "Ticket Closed (Admin)",
    subject: "Ticket Closed: {ticket_subject}",
    body: `<h2>Ticket Closed</h2>
<p>A support ticket has been closed by the customer.</p>
<p><strong>Customer:</strong> {customer_name} (@{customer_username})</p>
<p><strong>Email:</strong> {customer_email}</p>
<p><strong>Subject:</strong> {ticket_subject}</p>`,
    availableVariables: ["customer_name", "customer_username", "customer_email", "ticket_subject"],
    description: "Sent to all admins when a customer closes their ticket",
  },
  {
    templateKey: "customer_ticket_claimed",
    name: "Ticket Claimed (Customer)",
    subject: "Your Ticket Has Been Claimed: {ticket_subject}",
    body: `<h2>Your Ticket Has Been Assigned</h2>
<p>Great news! A team member has picked up your support ticket and will be assisting you shortly.</p>
<p><strong>Assigned To:</strong> {admin_name}</p>
<p><strong>Ticket:</strong> {ticket_subject}</p>
<p>You will be notified when there is an update on your ticket.</p>`,
    availableVariables: ["admin_name", "ticket_subject", "customer_name"],
    description: "Sent to the customer when an admin claims their ticket",
  },
  {
    templateKey: "customer_ticket_reply",
    name: "New Reply on Ticket (Customer)",
    subject: "New Reply to Your Support Ticket: {ticket_subject}",
    body: `<h2>New Reply on Your Ticket</h2>
<p>Our team has replied to your support ticket: <strong>{ticket_subject}</strong></p>
<blockquote>{message}</blockquote>
<p>If your issue has been resolved, you can close the ticket in the app. Otherwise, feel free to reply directly in the app.</p>`,
    availableVariables: ["ticket_subject", "message", "customer_name"],
    description: "Sent to the customer when an admin replies to their ticket",
  },
  {
    templateKey: "admin_ticket_reply",
    name: "New Ticket Message (Admin)",
    subject: "New Ticket Message: {ticket_subject}",
    body: `<h2>New Ticket Message</h2>
<p>A customer has replied to a support ticket.</p>
<p><strong>From:</strong> {customer_name} (@{customer_username})</p>
<p><strong>Ticket:</strong> {ticket_subject}</p>
<blockquote>{message}</blockquote>`,
    availableVariables: ["customer_name", "customer_username", "ticket_subject", "message"],
    description: "Sent to all admins when a customer replies to a ticket",
  },
  {
    templateKey: "admin_ticket_transfer",
    name: "Ticket Transfer (Admin)",
    subject: "Ticket Transfer: {ticket_subject}",
    body: `<h2>Ticket Transfer Request</h2>
<p>A support ticket has been transferred to you by {from_admin_name}.</p>
<p><strong>Reason:</strong> {transfer_reason}</p>
<p><strong>Ticket Subject:</strong> {ticket_subject}</p>
<p><strong>Description:</strong> {ticket_description}</p>
<p><strong>Priority:</strong> {ticket_priority}</p>
<p><strong>Customer:</strong> {customer_name} ({customer_email})</p>
<p>Please log in to the app to review and claim this ticket.</p>`,
    availableVariables: ["from_admin_name", "transfer_reason", "ticket_subject", "ticket_description", "ticket_priority", "customer_name", "customer_email"],
    description: "Sent to the target admin when a ticket is transferred to them",
  },
  {
    templateKey: "customer_ticket_transferred",
    name: "Ticket Transferred (Customer)",
    subject: "Your Ticket Has Been Transferred: {ticket_subject}",
    body: `<h2>Your Ticket Has Been Transferred</h2>
<p>Your support ticket has been successfully transferred to <strong>{admin_name}</strong> who will be assisting you going forward.</p>
<p><strong>Ticket:</strong> {ticket_subject}</p>
<p>You will be notified when there is an update on your ticket.</p>`,
    availableVariables: ["admin_name", "ticket_subject", "customer_name"],
    description: "Sent to the customer when their ticket is transferred to a new admin",
  },
  {
    templateKey: "customer_service_status",
    name: "Service Status Update",
    subject: "Service Status Update: {service_name}",
    body: `<h2>Service Status Update</h2>
<p>The status of a service you are subscribed to has been updated.</p>
<p><strong>Service:</strong> {service_name}</p>
<p><strong>New Status:</strong> {service_status}</p>
<p>Log in to the app for more details.</p>`,
    availableVariables: ["service_name", "service_status", "customer_name"],
    description: "Sent to subscribed customers when a service status changes",
  },
  {
    templateKey: "customer_service_alert",
    name: "New Service Alert",
    subject: "New Service Alert: {alert_title}",
    body: `<h2>New Service Alert</h2>
<p>An alert has been issued for a service you are subscribed to.</p>
<p><strong>{alert_title}</strong></p>
<blockquote>{alert_description}</blockquote>
<p>Log in to the app for real-time updates on this alert.</p>`,
    availableVariables: ["alert_title", "alert_description", "customer_name"],
    description: "Sent to subscribed customers when a new service alert is created",
  },
  {
    templateKey: "customer_service_update",
    name: "Service Update",
    subject: "Service Update: {service_name} - {update_title}",
    body: `<h2>Service Update: {service_name}</h2>
<p>There is a new update for a service you are subscribed to.</p>
<p><strong>{update_title}</strong></p>
<blockquote>{update_description}</blockquote>`,
    availableVariables: ["service_name", "update_title", "update_description", "customer_name"],
    description: "Sent to subscribed customers when a service update is posted",
  },
  {
    templateKey: "customer_news",
    name: "New News Story",
    subject: "News: {story_title}",
    body: `<h2>{story_title}</h2><p>{story_content}</p>`,
    availableVariables: ["story_title", "story_content"],
    description: "Sent to all customers when a new news story is published",
  },
  {
    templateKey: "customer_private_message",
    name: "Private Message (Customer)",
    subject: "Private Message from {sender_name}",
    body: `<h2>New Private Message</h2>
<p>You have received a message from <strong>{sender_name}</strong>.</p>
<p><strong>Subject:</strong> {message_subject}</p>
<blockquote>{message_body}</blockquote>
<p>Log in to the app to view and manage your messages.</p>`,
    availableVariables: ["sender_name", "message_subject", "message_body", "customer_name"],
    description: "Sent to a customer when an admin sends them a private message",
  },
  {
    templateKey: "customer_report_received",
    name: "Report/Request Received",
    subject: "{type_label} Received",
    body: `<h2>Your {type_label} Has Been Received</h2>
<p>Thank you for your submission. We have received and logged the following:</p>
<p><strong>Type:</strong> {type_label}</p>
<p><strong>Service:</strong> {service_name}</p>
<p><strong>Title:</strong> {report_title}</p>
{report_description_block}
<p>Our team will review your submission and take action as needed. You will receive a notification when there is an update.</p>`,
    availableVariables: ["type_label", "service_name", "report_title", "report_description_block", "customer_name"],
    description: "Confirmation sent to customer after submitting a report or request",
  },
  {
    templateKey: "admin_new_report",
    name: "New Report/Request (Admin)",
    subject: "New {type_label} from {customer_name}",
    body: `<h2>New {type_label}</h2>
<p>A customer has submitted a new {type_label_lower}.</p>
<p><strong>Customer:</strong> {customer_name} (@{customer_username})</p>
<p><strong>Email:</strong> {customer_email}</p>
<p><strong>Service:</strong> {service_name}</p>
<p><strong>Title:</strong> {report_title}</p>
{report_description_block}`,
    availableVariables: ["type_label", "type_label_lower", "customer_name", "customer_username", "customer_email", "service_name", "report_title", "report_description_block"],
    description: "Sent to all admins when a customer submits a report or request",
  },
  {
    templateKey: "customer_report_update",
    name: "Report/Request Status Update",
    subject: "{type_label} Update: {report_title}",
    body: `<h2>{type_label} Status Update</h2>
<p>There has been an update to your submission.</p>
<p><strong>Title:</strong> {report_title}</p>
<p><strong>New Status:</strong> {status_label}</p>
{admin_notes_block}
<p>Thank you for using CowboyMedia!</p>`,
    availableVariables: ["type_label", "report_title", "status_label", "admin_notes_block", "customer_name"],
    description: "Sent to the customer when their report/request status changes",
  },
  {
    templateKey: "ticket_transcript",
    name: "Ticket Closed - Conversation Transcript",
    subject: "Ticket Closed: {ticket_subject}",
    body: `<h2>Your Support Ticket Has Been Closed</h2>
<p>Hi {customer_name},</p>
<p>Your support ticket <strong>"{ticket_subject}"</strong> has been closed. Below is the full conversation transcript for your records.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<p><strong>Ticket:</strong> {ticket_subject}</p>
<p><strong>Description:</strong> {ticket_description}</p>
<p><strong>Opened:</strong> {opened_date}</p>
<p><strong>Closed:</strong> {closed_date}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<h3>Conversation</h3>
{conversation}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
<p>Thank you for contacting CowboyMedia Support. If you need further assistance, please submit a new ticket through the app.</p>`,
    availableVariables: ["ticket_subject", "ticket_description", "customer_name", "opened_date", "closed_date", "conversation"],
    description: "Sent to the customer when their ticket is closed, includes the full conversation transcript",
  },
  {
    templateKey: "customer_setup_reminder",
    name: "Account Setup Reminder",
    subject: "Complete Your CowboyMedia ServiceHub Setup",
    body: `<h2>Complete Your Account Setup</h2>
<p>Hi {customer_name},</p>
<p>Thanks for signing up for CowboyMedia ServiceHub! We noticed you haven't completed a couple of important steps to get the most out of your account:</p>
{missing_items}
<p>You can complete these steps anytime by visiting your <strong>Profile</strong> page in the app.</p>
<p>Without completing these steps, you won't be notified when new service issues arise or be able to fully take advantage of the many features the app provides regarding your service.</p>
<p style="color:#6b7280;font-size:13px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">This is a one-time reminder. You will not receive any more emails about this.</p>`,
    availableVariables: ["customer_name", "missing_items"],
    description: "One-time email sent 2 days after registration if push notifications or service subscriptions aren't set up",
  },
];

export async function seedEmailTemplates(): Promise<void> {
  for (const template of DEFAULT_EMAIL_TEMPLATES) {
    await storage.upsertEmailTemplate(template);
  }
  console.log("Email templates seeded/verified");
}

export function getDefaultTemplate(templateKey: string): { subject: string; body: string } | undefined {
  const def = DEFAULT_EMAIL_TEMPLATES.find(t => t.templateKey === templateKey);
  if (!def) return undefined;
  return { subject: def.subject, body: def.body };
}
