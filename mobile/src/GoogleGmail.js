export async function getUnreadEmails(token, maxResults = 3) {
  const listResponse = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const listData = await listResponse.json();
  const messages = listData.messages || [];

  const emails = await Promise.all(messages.map(async (message) => {
    const msgResponse = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgData = await msgResponse.json();
    const headers = msgData.payload?.headers || [];
    const from = headers.find((header) => header.name === 'From')?.value || 'Unknown';
    const subject = headers.find((header) => header.name === 'Subject')?.value || 'No subject';
    return { id: message.id, from, subject };
  }));
  return emails;
}

export function formatEmailsForSpeech(emails) {
  if (emails.length === 0) return 'Tidak ada email yang belum dibaca.';
  return `Ada ${emails.length} email belum dibaca. ` + emails.map((email) => {
    const fromName = email.from.split('<')[0].trim();
    return `Dari ${fromName}: ${email.subject}`;
  }).join('. ');
}
