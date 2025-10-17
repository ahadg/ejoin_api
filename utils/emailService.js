import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";

const apiKey = process.env.MAILSEND_API_KEY;
if (!apiKey) throw new Error("MAILSEND_API_KEY is not set");
const mailerSend = new MailerSend({
  apiKey,
});

export async function sendEmail(obj) {
  try {
    const sentFrom = new Sender("noreply@manapnl.com", "EJOIN");

    const recipients = [
      new Recipient(obj.to, "Your Client")
    ];
    
    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setReplyTo(sentFrom)
      .setSubject(obj.subject)
      .setHtml(obj.html)
      .setText(obj.text);
    
    await mailerSend.email.send(emailParams);
    
  } catch (error) {
    console.error('Error sending email:', error.response?.data || error);
    throw error;
  }
}

export async function sendPasswordEmail(email, resetLink) {
  const subject = "Reset Your Password - EJOIN";
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - EJOIN</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

        <!-- Content -->
        <div style="padding: 40px 30px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #1a202c; margin: 0 0 15px 0; font-size: 24px; font-weight: 600;">
              Reset Your Password
            </h2>
          </div>

          <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
            Hello there! 👋
          </p>
          
          <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
            We received a request to reset your password for your EJOIN account. Click the button below to create a new password:
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 35px 0;">
            <a href="${resetLink}" 
               style="display: inline-block; 
                      padding: 16px 32px; 
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                      color: #ffffff; 
                      text-decoration: none; 
                      border-radius: 8px; 
                      font-weight: 600; 
                      font-size: 16px; 
                      letter-spacing: 0.5px;
                      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                      transition: all 0.3s ease;">
              Reset My Password
            </a>
          </div>

          <p style="color: #718096; font-size: 14px; line-height: 1.5; margin: 30px 0 0 0; text-align: center;">
            This link will expire in 24 hours for security reasons.
          </p>

          <!-- Security Notice -->
          <div style="background-color: #f7fafc; border-left: 4px solid #667eea; padding: 20px; margin: 30px 0; border-radius: 0 6px 6px 0;">
            <p style="color: #4a5568; font-size: 14px; line-height: 1.5; margin: 0;">
              <strong>🔒 Security Notice:</strong> If you didn't request this password reset, you can safely ignore this email. Your account remains secure.
            </p>
          </div>

          <p style="color: #4a5568; font-size: 16px; line-height: 1.6; margin: 30px 0 0 0;">
            Best regards,<br/>
            <span style="color: #667eea; font-weight: 600;">The EJOIN Team</span>
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 30px; border-top: 1px solid #e2e8f0;">
          <p style="color: #a0aec0; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
            This email was sent to <span style="color: #4a5568; font-weight: 500;">${email}</span><br/>
            You're receiving this because you have an account with EJOIN.
          </p>
          <p style="color: #a0aec0; font-size: 12px; line-height: 1.5; margin: 15px 0 0 0; text-align: center;">
            EJOIN Inc. • 123 Business Street • City, Country
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
EJOIN Password Reset

Hello there!

We received a request to reset your password for your EJOIN account. 

Reset your password using this link:
${resetLink}

This link will expire in 24 hours for security reasons.

SECURITY NOTICE: If you didn't request this password reset, you can safely ignore this email. Your account remains secure.

Best regards,
The EJOIN Team

---
This email was sent to ${email}
You're receiving this because you have an account with EJOIN.
EJOIN Inc. • 123 Business Street • City, Country
  `;

  await sendEmail({
    to: email,
    subject,
    html,
    text,
  });
}