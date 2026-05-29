export async function getUpcomingEvents(token, maxResults = 5) {
  const now = new Date().toISOString();
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  return data.items || [];
}

export async function createEvent(token, event) {
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );
  return await response.json();
}

export async function deleteEvent(token, eventId) {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

export async function searchEvents(token, query) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${encodeURIComponent(query)}&maxResults=5&singleEvents=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  return data.items || [];
}

export function formatEventsForSpeech(events) {
  if (events.length === 0) return 'Tidak ada jadwal yang ditemukan.';
  return events.map((event) => {
    const start = event.start?.dateTime || event.start?.date;
    const date = new Date(start);
    const time = event.start?.dateTime
      ? date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : 'Sepanjang hari';
    return `${event.summary} jam ${time}`;
  }).join(', ');
}
