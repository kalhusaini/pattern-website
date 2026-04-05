// ---- SPA Page Navigation ----
function showPage(page) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // Close mobile menu if open
  document.getElementById('navLinks').classList.remove('mobile-open');
  // Trigger fade-up animations
  setTimeout(() => initFadeAnimations(), 100);
}

// ---- Language Toggle ----
function toggleLang() {
  document.body.classList.toggle('ar-active');
}

// ---- Mobile Menu ----
function toggleMobileMenu() {
  document.getElementById('navLinks').classList.toggle('mobile-open');
}

// ---- Navbar Scroll Effect ----
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }

  // Back to top visibility
  const btn = document.getElementById('backToTop');
  if (window.scrollY > 500) {
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
});

// ---- Fade-Up Animations ----
function initFadeAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-up').forEach(el => {
    el.classList.remove('visible');
    observer.observe(el);
  });
}

// ---- Booking System with Live Availability ----
// ---- DEBUGGED VERSION — timezone-safe, verbose logging ----

// *** CONFIGURATION — change this after deploying to Netlify ***
const ICAL_PROXY_BASE = '/.netlify/functions/ical';

const bookingData = {
  alghadeer: { en: 'WKN 25 Living', ar: 'وكن ٢٥ ليفنق' },
  qairawan:  { en: 'Qairawan Living', ar: 'القيروان ليفنق' },
  banban:    { en: 'Banan Retreat', ar: 'استراحة بنان' }
};

// Stores booked ranges per property: { alghadeer: [{from,to},...], ... }
const bookedRanges = {};
// Stores flatpickr instances: { 'checkin-alghadeer': fp, ... }
const pickers = {};

/**
 * BUG FIX: Timezone-safe date → "YYYY-MM-DD" using LOCAL time.
 * The old code used .toISOString().split('T')[0] which converts to UTC.
 * In UTC+3 (Saudi Arabia), midnight local = previous day 21:00 UTC,
 * so April 10 local was becoming "2026-04-09" — off by 1 day.
 */
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Check if a specific date falls inside any booked range (inclusive).
 * dateStr = "YYYY-MM-DD", ranges = [{ from: "...", to: "..." }, ...]
 */
function isDateBooked(dateStr, ranges) {
  return ranges.some(r => dateStr >= r.from && dateStr <= r.to);
}

/**
 * Check if the user's selected range [ciStr, coStr) overlaps any booked range.
 * ciStr/coStr = "YYYY-MM-DD". coStr is exclusive (checkout day = guest leaves).
 * A booked range { from, to } is inclusive on both ends (nights occupied).
 * Overlap exists when: ciStr <= r.to AND lastNight >= r.from
 */
function rangeOverlapsBooked(id, ciStr, coStr) {
  const ranges = bookedRanges[id] || [];
  // lastNight = day before checkout (last night the guest sleeps)
  const co = new Date(coStr + 'T12:00:00');
  co.setDate(co.getDate() - 1);
  const lastNight = toLocalDateStr(co);

  console.log('[Pattern Debug] rangeOverlapsBooked(' + id + '): check-in=' + ciStr + ', check-out=' + coStr + ', lastNight=' + lastNight);
  const overlap = ranges.some(r => {
    const hit = ciStr <= r.to && lastNight >= r.from;
    if (hit) console.log('[Pattern Debug]   OVERLAP with booked range: ' + r.from + ' → ' + r.to);
    return hit;
  });
  return overlap;
}

/**
 * Fetch availability from the Netlify proxy and initialize flatpickr for a property.
 * FIXED: flatpickr is ONLY initialized AFTER availability data is loaded.
 */
async function initPropertyBooking(id) {
  const loadingEl = document.getElementById('loading-' + id);
  const legendEl  = document.getElementById('legend-' + id);
  const errorEl   = document.getElementById('error-' + id);
  loadingEl.style.display = 'block';
  loadingEl.classList.add('visible');

  console.log('========================================');
  console.log('[Pattern Debug] INIT BOOKING: ' + id);
  console.log('[Pattern Debug] Fetching: ' + ICAL_PROXY_BASE + '?property=' + id);
  console.log('========================================');

  // The disable array for flatpickr — will contain { from: "...", to: "..." } range objects
  let disableRanges = [];
  let fetchFailed = false;

  try {
    const res = await fetch(ICAL_PROXY_BASE + '?property=' + id);
    console.log('[Pattern Debug] ' + id + ' — HTTP status: ' + res.status);

    if (res.ok) {
      const raw = await res.text();
      console.log('[Pattern Debug] ' + id + ' — RAW RESPONSE (first 500 chars):\n' + raw.substring(0, 500));

      let data;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        console.error('[Pattern Debug] ' + id + ' — JSON PARSE ERROR:', parseErr.message);
        console.error('[Pattern Debug] ' + id + ' — Raw response is NOT valid JSON. Full response:\n' + raw);
        fetchFailed = true;
        bookedRanges[id] = [];
      }

      if (data) {
        console.log('[Pattern Debug] ' + id + ' — Parsed JSON keys:', Object.keys(data));
        console.log('[Pattern Debug] ' + id + ' — bookedRanges array:', JSON.stringify(data.bookedRanges));
        console.log('[Pattern Debug] ' + id + ' — fetchedAt:', data.fetchedAt);

        bookedRanges[id] = data.bookedRanges || [];

        if (bookedRanges[id].length === 0) {
          console.warn('[Pattern Debug] ' + id + ' — WARNING: Server returned 0 booked ranges! Calendar shows all dates as available.');
        }

        // flatpickr natively supports { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
        disableRanges = bookedRanges[id].map(r => ({ from: r.from, to: r.to }));

        console.log('[Pattern Debug] ' + id + ' — BOOKED RANGES (' + bookedRanges[id].length + ' total):');
        bookedRanges[id].forEach((r, i) => {
          console.log('  Range ' + (i + 1) + ': ' + r.from + ' → ' + r.to);
        });
        console.log('[Pattern Debug] ' + id + ' — flatpickr disable array:', JSON.stringify(disableRanges));
      }
    } else {
      const errBody = await res.text();
      console.error('[Pattern Debug] ' + id + ' — FETCH FAILED (HTTP ' + res.status + ')');
      console.error('[Pattern Debug] ' + id + ' — Error response body:', errBody);
      fetchFailed = true;
      bookedRanges[id] = [];
    }
  } catch (err) {
    console.error('[Pattern Debug] ' + id + ' — NETWORK ERROR:', err.message);
    console.error('[Pattern Debug] ' + id + ' — This usually means:');
    console.error('  1. Site is opened locally (file://) — proxy only works on Netlify');
    console.error('  2. Netlify function is not deployed');
    console.error('  3. Network/CORS issue');
    fetchFailed = true;
    bookedRanges[id] = [];
  }

  loadingEl.style.display = 'none';
  loadingEl.classList.remove('visible');
  legendEl.style.display = 'flex';

  // Show a warning if fetch failed so the user knows availability isn't loaded
  if (fetchFailed) {
    const isAr = document.body.classList.contains('ar-active');
    errorEl.textContent = isAr
      ? 'تعذّر تحميل التوفر. جميع التواريخ تظهر متاحة — يُرجى التأكد عبر واتساب.'
      : 'Could not load availability. All dates appear open — please confirm via WhatsApp.';
    errorEl.style.display = 'block';
  }

  // Capture for closures
  const capturedRanges = bookedRanges[id];

  // Common flatpickr config — initialized AFTER data is loaded
  const baseConfig = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'M j, Y',
    minDate: 'today',
    disable: disableRanges,
    disableMobile: true,
    locale: { firstDayOfWeek: 0 },
    onDayCreate: function(dObj, dStr, fp, dayElem) {
      // BUG FIX: use toLocalDateStr instead of toISOString (timezone-safe)
      const ymd = toLocalDateStr(dayElem.dateObj);
      if (isDateBooked(ymd, capturedRanges)) {
        dayElem.classList.add('booked-date');
        const isAr = document.body.classList.contains('ar-active');
        dayElem.title = isAr ? 'محجوز' : 'Booked';
      }
    }
  };

  // Check-in picker
  pickers['checkin-' + id] = flatpickr('#checkin-' + id, {
    ...baseConfig,
    onChange: function(selectedDates) {
      if (selectedDates.length) {
        const nextDay = new Date(selectedDates[0]);
        nextDay.setDate(nextDay.getDate() + 1);
        pickers['checkout-' + id].set('minDate', nextDay);
        console.log('[Pattern Debug] ' + id + ' check-in selected: ' + toLocalDateStr(selectedDates[0]));
      }
      updateBooking(id);
    }
  });

  // Check-out picker
  pickers['checkout-' + id] = flatpickr('#checkout-' + id, {
    ...baseConfig,
    onChange: function(selectedDates) {
      if (selectedDates.length) {
        console.log('[Pattern Debug] ' + id + ' check-out selected: ' + toLocalDateStr(selectedDates[0]));
      }
      updateBooking(id);
    }
  });

  console.log('[Pattern Debug] ' + id + ' — flatpickr initialized with ' + disableRanges.length + ' disabled ranges');
  console.log('========================================');
}

function updateBooking(id) {
  const checkinFp  = pickers['checkin-' + id];
  const checkoutFp = pickers['checkout-' + id];
  const errorEl    = document.getElementById('error-' + id);
  const summaryEl  = document.getElementById('summary-' + id);
  const btnEl      = document.getElementById('bookbtn-' + id);
  const isAr       = document.body.classList.contains('ar-active');

  const checkin  = checkinFp.selectedDates[0];
  const checkout = checkoutFp.selectedDates[0];

  // Reset
  errorEl.textContent = '';
  errorEl.style.display = 'none';
  summaryEl.style.display = 'none';
  btnEl.disabled = true;

  if (!checkin || !checkout) return;

  if (checkout <= checkin) {
    errorEl.textContent = isAr
      ? 'تاريخ الخروج لازم يكون بعد تاريخ الدخول'
      : 'Check-out must be after check-in date';
    errorEl.style.display = 'block';
    return;
  }

  // BUG FIX: use toLocalDateStr instead of toISOString (timezone-safe)
  const ciStr = toLocalDateStr(checkin);
  const coStr = toLocalDateStr(checkout);

  console.log('[Pattern Debug] updateBooking(' + id + '): ciStr=' + ciStr + ', coStr=' + coStr);

  if (rangeOverlapsBooked(id, ciStr, coStr)) {
    console.log('[Pattern Debug] ' + id + ' — OVERLAP detected: ' + ciStr + ' to ' + coStr);
    errorEl.textContent = isAr
      ? 'الفترة المختارة تتعارض مع حجز موجود. اختر تواريخ ثانية.'
      : 'Selected dates overlap with an existing booking. Please choose different dates.';
    errorEl.style.display = 'block';
    return;
  }

  const nights = Math.round((checkout - checkin) / (1000 * 60 * 60 * 24));
  const formatDate = (d) => d.toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  summaryEl.innerHTML = isAr
    ? '<strong>' + nights + (nights === 1 ? ' ليلة' : ' ليالي') + '</strong> — من ' + formatDate(checkin) + ' إلى ' + formatDate(checkout)
    : '<strong>' + nights + (nights === 1 ? ' night' : ' nights') + '</strong> — ' + formatDate(checkin) + ' to ' + formatDate(checkout);
  summaryEl.style.display = 'block';
  btnEl.disabled = false;
  console.log('[Pattern Debug] ' + id + ' — valid selection: ' + ciStr + ' to ' + coStr + ' (' + nights + ' nights)');
}

function sendBooking(id) {
  const checkinFp  = pickers['checkin-' + id];
  const checkoutFp = pickers['checkout-' + id];
  const isAr       = document.body.classList.contains('ar-active');
  const prop       = bookingData[id];

  const checkin  = checkinFp.selectedDates[0];
  const checkout = checkoutFp.selectedDates[0];

  if (!checkin || !checkout || !prop) return;

  const fmt = (d) => d.toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  let msg;
  if (isAr) {
    msg = 'هلا، أبغى أحجز ' + prop.ar + '\nمن: ' + fmt(checkin) + '\nإلى: ' + fmt(checkout);
  } else {
    msg = 'Hi, I want to book ' + prop.en + '\nFrom: ' + fmt(checkin) + '\nTo: ' + fmt(checkout);
  }

  console.log('[Pattern Debug] ' + id + ' — sending to WhatsApp:', msg);
  window.open('https://wa.me/966531217758?text=' + encodeURIComponent(msg), '_blank');
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Pattern Debug] DOMContentLoaded — initializing booking system');
  console.log('[Pattern Debug] User timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('[Pattern Debug] Timezone offset: UTC' + (new Date().getTimezoneOffset() > 0 ? '-' : '+') + Math.abs(new Date().getTimezoneOffset() / 60));
  console.log('[Pattern Debug] Proxy base URL: ' + ICAL_PROXY_BASE);
  initFadeAnimations();
  // Initialize all 3 property booking systems
  ['alghadeer', 'qairawan', 'banban'].forEach(initPropertyBooking);
});