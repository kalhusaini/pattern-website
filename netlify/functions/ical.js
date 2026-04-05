// /.netlify/functions/ical
// Lightweight CORS proxy that fetches Airbnb iCal feeds and returns booked date ranges as JSON.

const ICAL_URLS = {
  alghadeer: 'https://www.airbnb.com/calendar/ical/1048603014414714970.ics?t=8f94524848354ca1bc216b52f21688b8&locale=en',
  qairawan:  'https://www.airbnb.com/calendar/ical/981119884855038331.ics?t=ee2b233842544225a3c63e15cc08f6d8&locale=en',
  banban:    'https://www.airbnb.com/calendar/ical/1359400080561654924.ics?t=d82969c64ec04d03972d4bfa7fe66d6c&locale=en',
};

// Alias so "wkn" also maps to alghadeer
ICAL_URLS.wkn = ICAL_URLS.alghadeer;

/**
 * Subtract 1 day from a "YYYY-MM-DD" string.
 * iCal DTEND is exclusive (checkout day), so the last *booked night* is DTEND - 1.
 */
function subtractOneDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Parse an iCal string and extract booked date ranges from VEVENT blocks.
 * Returns an array of { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 * where `from` = DTSTART and `to` = DTEND - 1 day (last booked night, inclusive).
 */
function parseICal(icsText) {
  const events = [];
  const blocks = icsText.split('BEGIN:VEVENT');

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];

    const startMatch = block.match(/DTSTART(?:;VALUE=DATE)?:(\d{4})(\d{2})(\d{2})/);
    const endMatch   = block.match(/DTEND(?:;VALUE=DATE)?:(\d{4})(\d{2})(\d{2})/);

    if (startMatch && endMatch) {
      const start = `${startMatch[1]}-${startMatch[2]}-${startMatch[3]}`;
      const endExclusive = `${endMatch[1]}-${endMatch[2]}-${endMatch[3]}`;
      const endInclusive = subtractOneDay(endExclusive);

      // Only add if the range is valid (at least 1 day)
      if (start <= endInclusive) {
        events.push({ from: start, to: endInclusive });
      }
    }
  }

  return events;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // cache 5 min
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const property = (event.queryStringParameters?.property || '').toLowerCase();
  const url = ICAL_URLS[property];

  if (!url) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid property. Use: alghadeer, qairawan, banban, or wkn',
      }),
    };
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Pattern-Booking/1.0' },
    });

    if (!response.ok) {
      throw new Error(`Airbnb returned ${response.status}`);
    }

    const icsText = await response.text();
    const booked = parseICal(icsText);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ property, bookedRanges: booked, fetchedAt: new Date().toISOString() }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch calendar', detail: err.message }),
    };
  }
};
