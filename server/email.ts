// SendGrid integration for sending transactional emails
import sgMail from '@sendgrid/mail';

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

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    await client.send({
      to,
      from: fromEmail || FALLBACK_FROM,
      subject,
      html,
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
