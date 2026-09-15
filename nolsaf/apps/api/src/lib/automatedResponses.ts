/**
 * Automated Response System for NoLSAF
 * Handles primary communications without AI API costs
 * Reusable across different sections of the platform
 * 
 * NOTE: Currently uses rule-based pattern matching with regex and fuzzy matching.
 * 
 * FUTURE ENHANCEMENT: ML/NLP Integration
 * To integrate ML/NLP (e.g., OpenAI GPT, custom trained model, or other NLP services):
 * 1. Add a new function `getMLResponse(userInput: string, language: string)` that calls your ML/NLP service
 * 2. Modify `getAutomatedResponse` to first try ML/NLP, then fall back to rule-based matching
 * 3. Consider caching ML responses for common queries to reduce costs
 * 4. Add confidence scoring to determine when to use ML vs. rule-based responses
 * 5. Log ML responses for continuous improvement and model training
 * 6. Example integration point:
 *    ```typescript
 *    try {
 *      const mlResponse = await getMLResponse(input, lang);
 *      if (mlResponse.confidence > 0.8) return mlResponse.text;
 *    } catch (error) {
 *      // Fall back to rule-based
 *    }
 *    // Continue with existing rule-based logic...
 *    ```
 */

import { translateResponse, getTranslation } from "./translations";

type LanguageCode = "en" | "es" | "fr" | "pt" | "ar" | "zh";
type ResponseType = "greeting" | "timeout" | "default" | "other";

/**
 * Calculate Levenshtein distance between two strings (fuzzy matching)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  const len1 = str1.length;
  const len2 = str2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[len2][len1];
}

/**
 * Calculate similarity score between two strings (0-1, where 1 is identical)
 */
function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

/**
 * Fuzzy match input against a pattern (handles typos)
 */
function fuzzyMatch(input: string, pattern: string, threshold: number = 0.7): boolean {
  // First try exact regex match
  if (new RegExp(pattern, "i").test(input)) {
    return true;
  }

  // Extract keywords from pattern (words longer than 2 chars)
  const patternWords = pattern.match(/\b\w{3,}\b/g) || [];
  const inputWords = input.match(/\b\w{3,}\b/g) || [];

  // Check if any pattern word has high similarity with any input word
  for (const patternWord of patternWords) {
    for (const inputWord of inputWords) {
      const sim = similarity(patternWord.toLowerCase(), inputWord.toLowerCase());
      if (sim >= threshold) {
        return true;
      }
    }
  }

  // Check overall similarity for short patterns
  if (pattern.length < 20) {
    const overallSim = similarity(input, pattern);
    if (overallSim >= threshold) {
      return true;
    }
  }

  return false;
}

export function getAutomatedResponse(userInput: string, language: string = "en"): string {
  const input = userInput.toLowerCase().trim();
  const lang = (language || "en") as LanguageCode;

  // Get English response with type (now with fuzzy matching)
  const { response: englishResponse, type: responseType } = getEnglishResponse(input);

  // Always attempt translation (translateResponse handles "en" case)
  const translatedResponse = translateResponse(englishResponse, lang, responseType);
  
  return translatedResponse;
}

function getEnglishResponse(input: string): { response: string; type: ResponseType } {
  // === GREETINGS & INITIAL CONTACT ===
  if (/^(hi+|hello|hey|hola|salut|good\s*(morning|afternoon|evening)|greetings|jambo|habari|mambo|niaje|sasa|shikamoo|hujambo|yo|sup|what'?s\s*up)/i.test(input)) {
    return {
      response: "Niaje! 👋 Naitwa Twiga 🦒, your friendly travel assistant at NoLSAF! 😊\n\nI can help with:\n🏨 Find & book verified accommodation\n🚗 Add transport to your booking (to/from your stay, tours, inter-city)\n🧭 Discover destinations and plan trips\n💳 Pay with Mpesa, cards, or bank transfer\n👥 Group bookings & custom itineraries\n\nAccommodation and tourism access, all connected. Just ask me anything!",
      type: "greeting"
    };
  }

  // === ABOUT NOLSAF ===
  if (/(what is nolsaf|what'?s nolsaf|about nolsaf|nolsaf is|tell me about nolsaf|who is nolsaf|who are you|what do you do|what is this platform|explain nolsaf|nolsaf mean|meaning of nolsaf)/.test(input)) {
    return { response: "NoLSAF connects your entire African journey in one unified platform 🌍\n\nBook verified accommodation, get transport to and from your stay, discover destinations, and pay with local methods, all seamlessly linked.\n\nPlanning a Serengeti safari? Book your lodge, add transport to get there and around, arrange game drives, and pay with Mpesa. No app switching, no friction.\n\n🏨 Verified Stays: hotels, lodges, villas, apartments across East Africa\n🚗 Integrated Transport: rides to/from your accommodation, city tours, inter-city travel\n🧭 Destination Discovery: safaris, cultural experiences, local guides\n💳 Local Payments: MPesa, Tigo, Airtel Money, cards accepted\n👥 Group Bookings: families, corporates, events\n\nAccommodation and tourism access, unified. Operating across Tanzania 🇹🇿, Kenya 🇰🇪, and expanding pan-Africa. What would you like to know more about?", type: "other" };
  }

  // === NOLSAF NAME / BRAND ===
  if (/(nolsaf stand|nolsaf mean|what does nolsaf|nolsaf full|nolsaf abbreviation|nolsaf acronym)/.test(input)) {
    return { response: "NoLSAF stands for \"Networked Occupancy & Logistics System-Africa\" 🌍\n\nWe solve end-to-end accommodation and tourism access as one unified experience. Book your stay and seamlessly add transport to get there, move around, and explore. Pay with mobile money. No app switching, no friction.\n\nBuilt for African infrastructure and how travelers actually move across the continent. Starting in East Africa and expanding pan-Africa! 🚀", type: "other" };
  }

  // === TWIGA (THE ASSISTANT) ===
  if (/(who are you|your name|twiga|what can you do|what do you know|are you (a |an )?(bot|ai|robot|human|real|person)|you real)/.test(input)) {
    return { response: "I'm Twiga 🦒, NoLSAF's travel assistant! Named after the Swahili word for giraffe - just like a twiga sees far across the savanna, I'm here to give you the best view of your travel options.\n\nI can help with:\n• Property bookings & recommendations\n• Transport arrangements\n• Payment questions\n• Destination info (Tanzania, Kenya, Zanzibar…)\n• Account & booking support\n• Owner & driver registration info\n\nI use smart pattern matching to understand your questions. For complex requests, I'll connect you with our human team! What can I help with?", type: "other" };
  }

  // === INTEGRITY & SAFETY / VERIFIED PROPERTIES ===
  if (/(safe|safety|secure|security|trust|trusted|reliable|legitimate|legit|scam|fraud|verified|authentic|integrity|verification|verify|is it (safe|real|legit))/.test(input)) {
    return { response: "NoLSAF takes trust seriously 🔒\n\n✅ Every property is verified before listing. We check ownership, photos, and quality\n🔐 Secure payment processing for all transactions\n🛡️ Guest protection on all bookings\n📋 Clear cancellation policies upfront\n👥 Dedicated support team for issues\n⭐ Review system for accountability\n\nWe don't list unverified properties. If something seems off with a listing, report it and we'll investigate immediately. Your safety is our priority!", type: "other" };
  }

  // === BOOKING - HOW TO ===
  if (/(\bbooking|\bbookings|\bbook\b|\breserve|\breservation|how (can|do|to) (i )?(book|reserve|make a (booking|reservation))|booking process|steps to book|i want to book|book now|book a|make a booking|can i book|is it possible to book)/.test(input)) {
    return { response: "Booking on NoLSAF is simple! 🏨\n\n1️⃣ Browse properties: search by city, region, or property type\n2️⃣ Select your dates & number of guests\n3️⃣ Choose a room/unit and review pricing\n4️⃣ Pick your payment method (M-Pesa, card, bank transfer)\n5️⃣ Confirm & receive your booking reference\n\nYou'll get an email confirmation with all details. The property owner is also notified and can message you directly.\n\n💡 Tip: Filter by amenities, price range, and nearby services to find exactly what you need!", type: "other" };
  }

  // === BOOKING REQUIREMENTS / SIGN UP ===
  if (/(what do i need|requirements? to book|documents? needed|account needed|sign up|register|create account|how to (register|sign up|create|join)|registration)/.test(input)) {
    return { response: "Getting started is quick! 🚀\n\nTo book, you need:\n📧 A valid email or phone number\n👤 A free NoLSAF account (takes under 2 minutes)\n💳 A payment method\n\nRegistration options:\n• Guest: browse & book properties\n• Owner: list your property on NoLSAF\n• Driver: join our transport network\n\nVisit the registration page, verify your email/phone via OTP, and you're ready to go! No documents needed for basic booking.", type: "other" };
  }

  // === OWNER REGISTRATION / LISTING ===
  if (/(property owner|become (an? )?owner|list (my |a )?property|register (as |my )?(an? )?owner|host|landlord|i have (a |an )?(property|hotel|lodge|apartment)|owner registration|owner account|how to list|add property)/.test(input)) {
    return { response: "Welcome! Here's how to list your property on NoLSAF 🏨\n\n1️⃣ Register as an Owner at /account/register?role=owner\n2️⃣ Complete your profile with ID verification\n3️⃣ Add your property: photos, description, amenities, pricing\n4️⃣ Our team verifies your listing (usually within 24-48 hours)\n5️⃣ Once approved, your property goes live!\n\nBenefits:\n✅ Access to travelers across East Africa\n💳 Secure payment collection (M-Pesa, cards, bank)\n📊 Dashboard with booking analytics\n💬 Direct messaging with guests\n📋 Flexible cancellation policies you control\n\nquestions about listing? Just ask!", type: "other" };
  }

  // === DRIVER REGISTRATION ===
  if (/(become (a )?driver|register (as )?(a )?driver|driver registration|driver account|join as driver|drive for nolsaf|transport provider|i have (a )?car|i (want to |can )drive)/.test(input)) {
    return { response: "Join NoLSAF as a driver! 🚗\n\n1️⃣ Register at /account/register?role=driver\n2️⃣ Submit your driving license & vehicle details\n3️⃣ Pass our verification process\n4️⃣ Start receiving ride requests!\n\nWhat drivers get:\n✅ Steady bookings from travelers\n💳 Reliable payments\n📱 Ride management dashboard\n🗺️ Transport to/from stays, city tours, inter-city trips\n\nWe're actively onboarding drivers across Tanzania and Kenya. Your vehicle, your schedule. We just connect you with travelers who need rides.", type: "other" };
  }

  // === REFERRAL PROGRAM ===
  if (/(referr?al|refer a friend|invite|share (code|link)|earn|referral (code|link|program)|how (to|do i) refer)/.test(input)) {
    return { response: "NoLSAF has a referral program! 🎁\n\nEvery user gets a unique referral code in their account profile. Share it with friends and when they sign up and make their first booking, you both benefit!\n\nFind your referral code:\n👤 Go to Account → Referral section\n📋 Copy your code or share link\n📲 Share via WhatsApp, SMS, or social media\n\nThe more people you refer, the more you earn. It's our way of saying thanks for spreading the word!", type: "other" };
  }

  // === BOOKING ISSUES / PROBLEMS ===
  if (/(booking (problem|issue|error|failed|not working)|can'?t book|unable to book|payment (issue|problem|failed|error|declined)|booking challenge|something went wrong|error (when|during|while))/.test(input)) {
    return { response: "Sorry you're having trouble! Let's fix it 💪\n\nCommon fixes:\n1️⃣ Check your internet connection\n2️⃣ Ensure all required fields are filled\n3️⃣ Verify your payment method is active & has funds\n4️⃣ Try a different payment method\n5️⃣ Clear browser cache or try another browser\n\nIf the issue persists:\n📧 Contact support through your account\n💬 Describe what happened & any error messages\n\nOur team typically responds within a few hours. We'll get you sorted!", type: "other" };
  }

  // === CANCELLATIONS & REFUNDS ===
  if (/(cancel|cancellation|refund|change booking|modify|reschedule|cancel policy|get my money back|money back)/.test(input)) {
    return { response: "Cancellation & refund info 📋\n\nHow to cancel:\n1️⃣ Go to My Bookings in your account\n2️⃣ Select the booking → Cancel\n3️⃣ Refund processed based on the property's policy\n\nPolicies vary by property:\n• Free cancellation: full refund within the window\n• Moderate: partial refund depending on timing\n• Strict: limited refund after confirmation\n\nThe exact policy is shown during booking. Refunds are processed to your original payment method (M-Pesa: 1-3 days, Card: 5-10 business days).\n\nNeed to modify dates instead? Contact the property owner directly through your booking.", type: "other" };
  }

  // === PROPERTIES / ACCOMMODATIONS ===
  if (/(property|properties|accommodation|hotel|lodge|resort|apartment|villa|stay|where to stay|place to stay|room|rooms|guest house|hostel|bungalow|cabin|condo|townhouse|homestay|bnb|airbnb|somewhere to sleep)/.test(input)) {
    return { response: "NoLSAF has a growing selection of verified stays 🏨\n\nProperty types available:\n🏢 Hotels  🏡 Lodges  🏠 Apartments  🏖️ Villas\n🏘️ Guest Houses  🛖 Bungalows  🏠 Homestays  🏢 Condos\n\nEvery listing includes:\n📸 Verified photos\n📍 Exact location with map\n💰 Clear pricing (per night)\n✨ Amenity list\n💳 Accepted payment methods\n📋 Cancellation policy\n\nUse our search filters (region, price range, property type, amenities, nearby services) to find your perfect match. Browse at /public/properties!", type: "other" };
  }

  // === AMENITIES ===
  if (/(amenities|wifi|parking|pool|breakfast|air conditioning|facilities|features|what'?s included|gym|restaurant|laundry|kitchen|balcony|hot water|tv|television)/.test(input)) {
    return { response: "Properties on NoLSAF list all their amenities! Common ones include:\n\n📶 WiFi  🅿️ Parking  🏊 Pool  🍳 Breakfast\n❄️ AC / Air Conditioning  🏋️ Gym  🍽️ Restaurant\n🧺 Laundry  🍳 Kitchen  📺 TV  🛁 Hot Water\n🔒 Safe  🌡️ Heating  🧴 Toiletries\n\nUse the amenity filters when searching to find properties with exactly what you need. Each property page shows the full list with icons.\n\n💡 Tip: Look for the verified badge ✅, it means we've confirmed these amenities in person!", type: "other" };
  }

  // === TRANSPORT / RIDES ===
  if (/(transport|ride|taxi|vehicle|car (hire|rental)|bus|driver|pickup|drop.?off|airport (transfer|pickup)|get (to|from)|how (to|do i) get (to|from|there)|travel from|inter.?city|shuttle)/.test(input)) {
    return { response: "NoLSAF transport services 🚗\n\nAvailable options:\n✈️ Airport transfers: pickup/drop-off at any airport\n🚙 City rides: get around town\n🗺️ Inter-city travel: Dar to Arusha, Zanzibar ferry connections, etc.\n🚐 Group transport: for families and larger parties\n\nAll drivers are verified with valid licenses. Book transport:\n1️⃣ Through your property booking (add-on)\n2️⃣ Separately via the transport section\n\nSpecify pickup point 📍, destination, date & time. Driver details are shared before your trip.", type: "other" };
  }

  // === GROUP STAY ===
  if (/(group stay|group (booking|accommodation|travel|trip)|family (stay|trip|booking)|large group|corporate (booking|stay|event)|team (building|retreat)|many (people|rooms)|wedding (accommodation|venue)|conference)/.test(input)) {
    return { response: "Group Stay, perfect for larger parties! 👥\n\nGreat for:\n👨‍👩‍👧‍👦 Family vacations\n🏢 Corporate retreats & conferences\n🎉 Weddings & celebrations\n🏫 School/university trips\n👥 Friend groups\n\nBenefits:\n💰 Group rates & potential discounts\n🏨 Multiple room coordination\n🚗 Group transport arrangements\n📋 Flexible group cancellation\n👤 Single point of contact\n\nSubmit a Group Stay request through the platform. Properties with group-friendly tags show up in filters!", type: "other" };
  }

  // === PRICING / COST / PAYMENTS ===
  if (/(price|cost|budget|affordable|cheap|expensive|how much|pricing|fee|fees|discount|promotion|offer|deal)/.test(input)) {
    return { response: "Pricing on NoLSAF 💰\n\nProperty prices vary by type & location:\n💵 Budget: TZS 20,000–50,000/night\n💰 Mid-range: TZS 50,000–200,000/night\n⭐ Premium: TZS 200,000+/night\n\nAll prices are shown per night and include the listed amenities. No hidden fees. What you see is what you pay.\n\n💡 Tips to save:\n• Filter by price range\n• Check for longer-stay discounts\n• Group Stay may offer better rates\n• Compare similar properties in the same area\n\nNeed help finding something in your budget? Tell me your destination and price range!", type: "other" };
  }

  // === PAYMENT METHODS (DETAILED) ===
  if (/(payment|pay|paying|how (can|do) i pay|payment method|mpesa|m-pesa|airtel money|mixx by yas|haloPesa|bank transfer|credit card|debit card|visa|mastercard|mobile money|azampay|ways to pay)/.test(input)) {
    return { response: "NoLSAF supports multiple payment methods 💳\n\n📱 Mobile Money:\n• M-Pesa \n• Mixx by Yas\n• Airtel Money\n• HaloPesa \n Instant processing, no extra fees\n\n💳 Card Payments:\n• Visa & Mastercard (debit & credit)\n→ Processed securely via Stripe\n\n🏦 Bank Transfer:\n• Available for larger bookings\n\nAll payments are encrypted and secure 🔐. You choose your preferred method at checkout. Mobile money is the fastest option in Tanzania!\n\nHaving payment issues? Make sure your account has sufficient balance and try again.", type: "other" };
  }

  // === BOOKING STATUS / TRACKING ===
  if (/(status|track|where is|my booking|booking status|confirm|confirmation|check my|what happened|booking history)/.test(input)) {
    return { response: "Check your booking status 📋\n\nGo to your Account → My Bookings to see:\n• Booking reference number\n• Current status (Pending / Confirmed / Completed / Cancelled)\n• Property details & contact\n• Payment status\n• Check-in/out dates\n\nYou'll also receive email notifications for status updates. If a booking shows \"Pending\" for too long, the property owner may need time to confirm. You can message them directly.\n\nCan't find your booking? Check your email for the confirmation, or contact support with your booking reference.", type: "other" };
  }

  // === CONTACT / SUPPORT ===
  if (/(contact|support|help me|phone|email|talk to|speak (with|to)|reach|customer service|assistance|how (to|do i) (contact|reach)|support team)/.test(input)) {
    return { response: "Need help? Here's how to reach us 💬\n\n📧 Email: support from your account dashboard\n💬 In-app messaging: Account → Support\n🤖 Right here! I can answer many questions\n\nFor booking issues:\n→ Go to My Bookings → select the booking → Contact Support\n\nFor property issues:\n→ Message the property owner directly through your booking\n\nFor urgent matters:\n→ Use the support form with \"Urgent\" priority\n\nOur team aims to respond within a few hours during business hours. What do you need help with?", type: "other" };
  }

  // === DESTINATIONS - ZANZIBAR ===
  if (/(zanzibar|stone town|unguja|pemba|nungwi|kendwa|paje|jambiani|spice (island|tour)|zanzibar (beach|hotel|stay))/.test(input)) {
    return { response: "Zanzibar, the Spice Island! 🏝️\n\nTop areas to stay:\n🏖️ Nungwi: stunning northern beaches, vibrant nightlife\n🌊 Kendwa: calm waters, beachfront lodges\n🏄 Paje: kite surfing capital, laid-back vibe\n🕌 Stone Town: UNESCO heritage, culture & history\n🐚 Jambiani: quiet, authentic local experience\n🌴 Pemba Island: diving paradise, remote luxury\n\nPopular activities: Spice tours, snorkeling, dhow cruises, Stone Town walks, Prison Island, Mnemba Atoll diving\n\nWe have verified properties across all Zanzibar areas. Search by \"Zanzibar\" to browse! 🔍", type: "other" };
  }

  // === DESTINATIONS - DAR ES SALAAM ===
  if (/(dar es salaam|dar|dsm|kariakoo|masaki|oyster bay|mikocheni|mbezi|kigamboni|bongoyo)/.test(input)) {
    return { response: "Dar es Salaam, Tanzania's commercial capital! 🌊\n\nPopular areas:\n🏢 Masaki/Oyster Bay: upscale, restaurants, ocean views\n🏙️ City Centre: business hub, markets\n🌴 Mikocheni: residential, quiet, good mid-range stays\n🏖️ Kigamboni: beach side, growing tourist area\n🏝️ Bongoyo Island: day trip, pristine beach\n⛴️ Ferry terminal: gateway to Zanzibar\n\nDar is the starting point for many Tanzania trips. Ferry to Zanzibar takes 1.5-2 hours. Julius Nyerere International Airport (DAR) connects to all major cities.\n\nBrowse Dar es Salaam properties on NoLSAF!", type: "other" };
  }

  // === DESTINATIONS - ARUSHA / NORTHERN CIRCUIT ===
  if (/(arusha|kilimanjaro|serengeti|ngorongoro|moshi|tarangire|lake manyara|northern circuit|climb kilimanjaro|mount kilimanjaro|mt kilimanjaro)/.test(input)) {
    return { response: "Northern Tanzania, safari & adventure capital! ⛰️\n\n🏔️ Mount Kilimanjaro: Africa's highest peak (5,895m), 5-9 day treks from Moshi\n🦁 Serengeti: Great Migration, Big Five, endless plains\n🦏 Ngorongoro Crater: world's largest caldera, incredible wildlife density\n🐘 Tarangire: famous for elephants & baobab trees\n🦩 Lake Manyara: flamingos, tree-climbing lions\n🌄 Arusha: gateway city, vibrant market, Arusha National Park\n\nMost safaris depart from Arusha. Book accommodation there as your base, then arrange game drives.\n\nWe have lodges and hotels across the northern circuit!", type: "other" };
  }

  // === DESTINATIONS - TANZANIA (GENERAL) ===
  if (/(tanzania|tanzanian|dodoma|mwanza|mbeya|iringa|morogoro|tanga|lindi|mtwara|rukwa|tabora|lake victoria|selous|ruaha|mikumi|udzungwa)/.test(input)) {
    return { response: "Tanzania 🇹🇿, incredible diversity!\n\nBeyond the famous spots:\n🏙️ Dodoma: capital city, growing hub\n🌊 Mwanza: Lake Victoria's largest city, rock formations\n⛰️ Mbeya: highland scenery, coffee country\n🌿 Morogoro: Uluguru Mountains, gateway to Mikumi\n🦁 Selous/Nyerere: largest game reserve in Africa\n🐆 Ruaha: remote, uncrowded safaris\n🌳 Udzungwa: rainforest hiking, endemic species\n🏖️ Tanga: quiet coast, Usambara Mountains nearby\n\nTanzania has 17+ national parks and reserves. Whether beach, safari, mountain, or city, we've got accommodation options. Where are you headed?", type: "other" };
  }

  // === DESTINATIONS - KENYA ===
  if (/(kenya|nairobi|masai mara|maasai mara|mombasa|malindi|lamu|diani|amboseli|tsavo|lake nakuru|kenyan)/.test(input)) {
    return { response: "Kenya 🇰🇪, incredible wildlife & culture!\n\n🦁 Maasai Mara: Great Migration (Jul-Oct), Big Five\n🏙️ Nairobi: capital, Nairobi National Park, Giraffe Centre\n🏖️ Mombasa/Diani: Indian Ocean beaches, water sports\n🏝️ Lamu: UNESCO heritage island, Swahili culture\n🐘 Amboseli: elephants with Kilimanjaro backdrop\n🦏 Tsavo: vast wilderness, red elephants\n🦩 Lake Nakuru: flamingos, rhinos\n\nNoLSAF is expanding property listings in Kenya. Airport transfers and transport services available in Nairobi and Mombasa.", type: "other" };
  }

  // === DESTINATIONS - GENERAL / WHERE TO GO ===
  if (/(where (should|can) i (go|visit|travel)|destination|best (place|destination)|recommend.*(place|destination|city|area)|suggest|popular (destination|place)|where to go|top (destination|place))/.test(input)) {
    return { response: "Popular destinations we serve 🌍\n\n🇹🇿 Tanzania:\n• Zanzibar: beaches, culture, spice tours\n• Serengeti/Ngorongoro: world-class safaris\n• Kilimanjaro: trekking\n• Dar es Salaam: city life, Zanzibar gateway\n• Arusha: safari base, vibrant town\n\n🇰🇪 Kenya:\n• Maasai Mara: Great Migration\n• Nairobi: cosmopolitan capital\n• Mombasa/Diani: coastal paradise\n\nBest combos:\n🏖️+🦁 Zanzibar + Serengeti (beach & safari)\n⛰️+🏖️ Kilimanjaro + Zanzibar (climb & relax)\n🌍 Dar + Arusha + Zanzibar (full Tanzania experience)\n\nWhat kind of experience are you looking for?", type: "other" };
  }

  // === SAFARI / WILDLIFE ===
  if (/(safari|wildlife|animal|game drive|big five|lion|elephant|giraffe|zebra|wildebeest|migration|national park|game reserve|bird|birding|flamingo)/.test(input)) {
    return { response: "East Africa, the world's best safari destination! 🦁\n\nTop safari parks:\n🦓 Serengeti: Great Migration, Big Five\n🦏 Ngorongoro Crater: incredible density of wildlife\n🐘 Tarangire: elephant herds, baobabs\n🦁 Maasai Mara: Kenya's premier park\n🐆 Ruaha/Selous: off-the-beaten-track\n\nSafari types:\n🚙 Game drives (most common)\n🚶 Walking safaris\n🎈 Hot air balloon safaris\n🏕️ Camping safaris\n\nBook safari lodges on NoLSAF, then arrange game drives through your property or a verified tour operator. Best viewing: dry season (June–October, December–February).", type: "other" };
  }

  // === CHECK-IN / CHECK-OUT ===
  if (/(check.?in|check.?out|arrival|departure|early (check.?in|arrival)|late (check.?out|departure)|check.?in time|what time)/.test(input)) {
    return { response: "Check-in & check-out times ⏰\n\nStandard times (varies by property):\n🟢 Check-in: 2:00 PM – 3:00 PM\n🔴 Check-out: 10:00 AM – 12:00 PM\n\nEarly check-in or late check-out may be available. Contact the property directly through your booking to request. Some properties charge extra, others accommodate for free based on availability.\n\nExact times are shown on your booking confirmation and the property listing page.", type: "other" };
  }

  // === ACCOUNT / PROFILE / LOGIN ===
  if (/(account|profile|login|log in|sign in|my account|dashboard|password|forgot password|reset password|can'?t (log|sign) in|locked out|change (password|email|phone)|update (profile|account)|2fa|two.?factor|otp)/.test(input)) {
    return { response: "Account help 👤\n\n🔑 Can't log in?\n→ Use \"Forgot Password\" on the login page\n→ Check your email/SMS for the OTP code\n→ Password must be strong (min 8 chars, mixed case, numbers)\n\n👤 Update profile:\n→ Account → Profile → Edit\n→ Change name, phone, email, photo\n\n🔐 Security:\n→ Two-factor authentication (2FA) available\n→ OTP sent via SMS for verification\n→ Password reset via email link\n\n📋 Your dashboard shows:\n→ Bookings, messages, referral code, notifications\n\nStill stuck? Contact support through the platform.", type: "other" };
  }

  // === CULTURE & EXPERIENCES ===
  if (/(culture|cultural|tradition|traditional|local experience|tribe|tribal|masai|maasai|swahili|experience|authentic|heritage|local life|immersion)/.test(input)) {
    return { response: "East African cultural experiences 🎭\n\n🏘️ Maasai village visits: warriors, traditions, beadwork\n🕌 Zanzibar Stone Town: UNESCO heritage, Swahili architecture, spice tours\n🛒 Local markets: Kariakoo (Dar), Maasai Market (Nairobi)\n💃 Traditional dance & music\n🍽️ Cooking classes: learn to make pilau, ugali, chapati\n🎨 Art galleries & craft workshops\n☕ Coffee plantation tours (Arusha/Kilimanjaro)\n🏗️ Historical sites: Bagamoyo, Kilwa ruins", type: "other" };
  }

  // === FOOD & DINING ===
  if (/(food|restaurant|dining|meal|cuisine|eat|local food|dietary|vegetarian|vegan|halal|what to eat|breakfast|lunch|dinner|street food)/.test(input)) {
    return { response: "East African food is delicious! 🍽️\n\nMust-try dishes:\n🥘 Ugali & stew: staple meal\n🍖 Nyama choma: grilled meat\n🍚 Pilau/Biryani: spiced rice\n🫓 Chapati: flatbread\n🐟 Grilled fish: especially on the coast\n🍌 Ndizi (plantain) dishes\n🥥 Coconut-based curries (Zanzibar specialty)\n\nDietary needs: Many restaurants accommodate vegetarian, vegan & halal. Mention when booking if you need special meals.\n\nStreet food tip: Choose busy stalls with high turnover for fresh food. Zanzibar night market at Forodhani Gardens is a must-visit! 😋", type: "other" };
  }

  // === WEATHER / BEST TIME TO VISIT ===
  if (/(when to visit|best time|weather|season|dry season|wet season|rain|climate|temperature|hot|cold|monsoon)/.test(input)) {
    return { response: "Best times to visit East Africa 📅\n\n☀️ Dry seasons (best for safari):\n→ June–October: cool & dry, peak wildlife viewing\n→ December–February: warm & dry, good all-round\n\n🌧️ Wet seasons:\n→ March–May: long rains (lower prices, lush green)\n→ November: short rains (usually manageable)\n\n🏖️ Beach holidays: Year-round, best June–March\n⛰️ Kilimanjaro: January–March & June–October\n🦁 Great Migration: July–October (Serengeti/Mara)\n\nEvery season has its charm! Wet season = fewer crowds and lower prices. Dry season = best wildlife sightings. When are you planning to travel?", type: "other" };
  }

  // === VISA / TRAVEL DOCUMENTS ===
  if (/(visa|passport|document|permit|entry|border|cross border|immigration|do i need a visa|travel requirements|e.?visa)/.test(input)) {
    return { response: "Travel requirements 📋\n\n🛂 Passport: Must be valid 6+ months from entry\n\n🇹🇿 Tanzania visa:\n→ Most nationalities: visa on arrival ($50 USD) or e-visa\n→ Apply at immigration.go.tz\n\n🇰🇪 Kenya:\n→ e-visa required for most (evisa.go.ke)\n→ ETA system being rolled out\n\n🎫 East Africa Tourist Visa:\n→ Covers Tanzania, Kenya, Uganda ($100)\n→ 90 days, multiple entries between the 3 countries\n\n⚠️ Always check current requirements with your country's travel advisory. Requirements change, so verify before you fly!\n\nNeed gorilla trekking permits? Those are separate and should be booked months in advance.", type: "other" };
  }

  // === CURRENCY / MONEY ===
  if (/(currency|money|exchange|usd|dollar|shilling|how much|atm|bank|cash|exchange rate|forex|tip|tipping)/.test(input)) {
    return { response: "Money matters 💵\n\nCurrencies:\n🇹🇿 Tanzanian Shilling (TZS): ~2,500 TZS = $1 USD\n🇰🇪 Kenyan Shilling (KES): ~130 KES = $1 USD\n\n💡 Tips:\n• USD widely accepted in tourist areas (bring clean post-2006 bills)\n• ATMs available in major cities (Visa/Mastercard)\n• Mobile money (M-Pesa) is king, easy to set up\n• Exchange at banks or authorized forex bureaus, not street changers\n• Hotels often have higher exchange rates\n\n💰 Tipping:\n→ Guides: $10-20/day\n→ Drivers: $5-10/day\n→ Hotels: TZS 2,000-5,000\n→ Restaurants: 5-10% if no service charge\n\nNoLSAF accepts TZS, KES, and USD for bookings!", type: "other" };
  }

  // === INTERNET / CONNECTIVITY ===
  if (/(internet|wifi|data|mobile data|roaming|network|sim card|phone|connectivity|stay connected|cell|cellular)/.test(input)) {
    return { response: "Staying connected 📶\n\n📱 Local SIM cards (recommended):\n→ Buy at airport or any phone shop (~$2-5)\n→ Tanzania: Vodacom, Airtel, Tigo\n→ Kenya: Safaricom (best coverage), Airtel\n→ Data bundles: ~$5 for 5GB\n\n📶 WiFi:\n→ Available at most hotels & restaurants in cities\n→ Safari lodges: often have WiFi (can be slow)\n→ Remote areas: limited, enjoy disconnecting!\n\n💡 Tip: Download offline maps (Google Maps) before going on safari. Some parks have no coverage at all.\n\nMost NoLSAF properties list WiFi availability in their amenities!", type: "other" };
  }

  // === HEALTH / VACCINATIONS ===
  if (/(vaccination|vaccine|yellow fever|malaria|health|doctor|hospital|medical|pharmacy|sick|illness|mosquito)/.test(input)) {
    return { response: "Health tips for East Africa 💉\n\n🟡 Yellow Fever: Certificate often required, get vaccinated before travel\n🦟 Malaria: Take prophylaxis (consult your doctor), use repellent & mosquito nets\n💧 Water: Drink bottled/filtered water\n☀️ Sun: Use SPF 30+, wear hats\n🏥 Hospitals: Available in major cities; travel insurance strongly recommended\n\n📋 Recommended vaccines:\n→ Yellow Fever (often required)\n→ Hepatitis A & B\n→ Typhoid\n→ Routine vaccines (tetanus, etc.)\n\n⚠️ Visit a travel clinic 4-6 weeks before your trip. Bring any personal medications. Pharmacies exist but may not have everything.", type: "other" };
  }

  // === PACKING ===
  if (/(pack|packing|what to bring|what to pack|clothing|luggage|essentials|packing list|wear|dress code)/.test(input)) {
    return { response: "Packing essentials 🎒\n\n🦁 Safari:\n→ Neutral colors (khaki, olive, beige)\n→ Long sleeves & pants (sun/mosquito protection)\n→ Binoculars, camera, extra batteries\n→ Comfortable walking shoes\n\n🏖️ Beach:\n→ Swimwear, sunscreen SPF 30+\n→ Light cotton clothing, hat\n→ Reef-safe sunscreen\n→ Cover-ups for visiting Stone Town/villages\n\n⛰️ Kilimanjaro/Mountains:\n→ Warm layers, down jacket\n→ Waterproof gear, hiking boots\n→ Thermal underwear for summit\n\n📌 Always:\n→ Passport, travel insurance docs\n→ Adapter (Type D/G plugs)\n→ Headlamp/flashlight\n→ Insect repellent (DEET 30%+)", type: "other" };
  }

  // === LANGUAGE / SWAHILI ===
  if (/(language|swahili|english|speak|communication|translate|local language|learn swahili|useful phrases|basic swahili)/.test(input)) {
    return { response: "Languages in East Africa 🗣️\n\nSwahili (Kiswahili) & English are widely spoken. Learn these basics:\n\n🤝 Greetings:\n→ Jambo / Habari: Hello\n→ Mambo / Niaje: Hey! (casual)\n→ Shikamoo: Respectful greeting (to elders)\n\n🙏 Essentials:\n→ Asante (sana): Thank you (very much)\n→ Karibu: Welcome / You're welcome\n→ Tafadhali: Please\n→ Pole: Sorry\n→ Hakuna matata: No worries!\n→ Ndio / Hapana: Yes / No\n\n🛍️ Useful:\n→ Bei gani?: How much?\n→ Punguza bei: Lower the price\n→ Chakula: Food\n→ Maji: Water\n\nLocals love it when visitors try Swahili! 😊", type: "other" };
  }

  // === EMERGENCY / URGENT ===
  if (/(emergency|urgent|help|stuck|lost|stolen|accident|need help|immediate|sos|danger|police|fire|ambulance)/.test(input)) {
    return { response: "Emergency contacts 🚨\n\n🇹🇿 Tanzania:\n→ Police: 112 or 999\n→ Fire: 114\n→ Ambulance: 114\n\n🇰🇪 Kenya:\n→ All emergencies: 999 or 112\n\n📋 What to do:\n1️⃣ Call local emergency number\n2️⃣ Contact your hotel/accommodation\n3️⃣ Reach your country's embassy\n4️⃣ Contact travel insurance provider\n5️⃣ For booking emergencies: NoLSAF support\n\n💡 Keep copies of your passport, insurance, and booking confirmations. Share your itinerary with family back home.\n\nIf this is a booking-related emergency, contact our support team. We'll prioritize your case!", type: "other" };
  }

  // === REVIEWS / RATINGS ===
  if (/(review|rating|testimonial|feedback|recommend|stars?|how (is|was|are)|reputation|is .+ good)/.test(input)) {
    return { response: "Reviews & ratings ⭐\n\nAfter your stay, you can leave a review:\n→ Go to My Bookings → select completed booking → Write Review\n→ Rate 1-5 stars + written feedback\n→ Reviews are public and help other travelers\n\nWhen choosing a property:\n→ Check the review section on each listing\n→ Look for the verified badge ✅\n→ Read recent reviews for current experience\n→ Properties respond to reviews too\n\nWe verify all reviews to ensure they're from real guests. Honest feedback helps us maintain quality across the platform!", type: "other" };
  }

  // === FAMILY / CHILDREN ===
  if (/(family|children|kids|baby|infant|child.?friendly|family.?friendly|age|children activities|travel with kids|bring (my |the )?kids)/.test(input)) {
    return { response: "Traveling with family 👨‍👩‍👧‍👦\n\nFamily-friendly features on NoLSAF:\n🏨 Filter for family-friendly properties\n👶 Cots/cribs available at many hotels\n🍽️ Children's menus at restaurants\n🚗 Family transport with child seats (request in advance)\n👥 Group Stay for larger families\n\nKid-friendly activities:\n🦁 Safari game drives (most parks welcome all ages)\n🏖️ Beach days: safe, shallow areas in Zanzibar\n🐢 Turtle conservation, Jozani Forest\n🏊 Hotel pools\n\n⚠️ Some walking safaris & activities have minimum age requirements (usually 12-16). Check with the park/operator. Most hotels are very accommodating for families!", type: "other" };
  }

  // === PHOTOGRAPHY / INSTAGRAM ===
  if (/(camera|photography|photos?|pictures?|video|drone|instagram|instagrammable|photo spot|best photo)/.test(input)) {
    return { response: "Photography tips 📸\n\nBest photo spots:\n🦁 Serengeti: golden hour on the plains\n🏖️ Zanzibar: turquoise waters, dhow boats\n🕌 Stone Town: narrow streets, carved doors\n⛰️ Kilimanjaro: early morning summit views\n🦍 Gorillas: once-in-a-lifetime shots\n\n📌 Rules:\n→ National parks: cameras allowed, pro equipment may need permits\n→ Drones: require permits in most countries, apply in advance\n→ People: always ask before photographing locals\n→ Military/government buildings: photography usually prohibited\n\n💡 Golden hour (6-7am, 5-6pm) gives the best safari light. Bring extra memory cards and batteries. You'll take thousands of photos!", type: "other" };
  }

  // === COMMISSION / HOW NOLSAF WORKS FOR OWNERS ===
  if (/(commission|how.* (nolsaf|you) (make|earn) money|business model|service (fee|charge)|platform fee|owner (fee|charge|earnings)|how (much|do) (you|nolsaf) (take|charge))/.test(input)) {
    return { response: "How NoLSAF works for property owners 💼\n\nNoLSAF charges a small commission on successful bookings. This covers platform maintenance, verification, payment processing, and customer support.\n\nOwner benefits:\n✅ Verified listing badge builds trust\n📊 Booking dashboard & analytics\n💳 Multiple payment collection methods\n📱 Guest messaging system\n🌍 Exposure to travelers across East Africa\n📋 You set your own prices & cancellation policy\n\nCommission rates are transparent and competitive. For exact rates, check the owner registration section or contact our team.", type: "other" };
  }

  // === MOBILE APP ===
  if (/(app|mobile app|download|android|ios|iphone|play store|app store|install)/.test(input)) {
    return { response: "NoLSAF is currently a web platform 🌐\n\nAccess NoLSAF from any device at www.nolsaf.com. It's fully optimized for mobile browsers!\n\n📱 Mobile tips:\n→ Add to home screen for app-like experience\n→ Works on any smartphone browser\n→ Full booking, messaging, and account features\n→ Chatbot (me!) works on mobile too\n\nA dedicated mobile app is on our roadmap! For now, the mobile web experience gives you everything you need. Bookmark us! 📌", type: "other" };
  }

  // === NEARBY SERVICES ===
  if (/(nearby|near me|around|close to|what'?s (near|around|close)|location|map|distance|far|how far)/.test(input)) {
    return { response: "Finding what's nearby 📍\n\nNoLSAF properties show nearby services:\n🏥 Hospital/Clinic\n🍽️ Restaurant/Café\n☕ Coffee shops\n🏖️ Beach\n🛒 Shopping/Markets\n⛽ Gas station\n🚌 Bus station\n✈️ Airport distance\n🏛️ Tourist attractions\n\nUse the \"Nearby Me\" filter:\n1️⃣ Enable location on your device\n2️⃣ Open filters → Nearby Me → Enable\n3️⃣ Set your preferred radius (1-50 km)\n4️⃣ See properties sorted by distance\n\nEach property listing also shows what's within walking distance!", type: "other" };
  }

  // === SWAHILI GREETINGS (catch Swahili-only inputs) ===
  if (/^(asante|karibu|pole|hakuna matata|ndiyo|hapana|sawa|poa|bwana|dada|kaka|rafiki|safari njema|tutaonana|kwaheri|salama)/.test(input)) {
    return { response: "Karibu sana! 😊 You speak some Swahili, that's great! I'm Twiga 🦒, and I'm happy to help you in English (or switch languages using the selector above).\n\nWhat can I help you with today?\n🏨 Property bookings\n🚗 Transport\n💳 Payments\n🌍 Destination info\n👤 Account help", type: "other" };
  }

  // === COMPARISON / WHAT'S BETTER ===
  if (/(compare|which is better|vs|versus|difference between|should i choose|what'?s (better|best)|between .+ and)/.test(input)) {
    return { response: "Need help choosing? Consider these factors 🤔\n\n📍 Location: close to your activities?\n💰 Budget: what's your nightly range?\n✨ Amenities: WiFi, pool, breakfast, AC?\n👥 Group size: rooms/beds needed?\n⭐ Reviews: what do other guests say?\n📋 Cancellation policy: flexibility needed?\n\nUse our search filters to narrow down options, then compare listings side by side.", type: "other" };
  }

  // === ACCESSIBILITY ===
  if (/(accessible|disability|wheelchair|mobility|special needs|handicap|disabled)/.test(input)) {
    return { response: "Accessible travel on NoLSAF ♿\n\nAccessibility varies by property. When searching:\n→ Check property descriptions for accessibility info\n→ Contact the property directly to confirm specific needs\n→ Mention requirements in your booking notes\n\nMany hotels offer:\n• Ground floor rooms\n• Wheelchair ramps\n• Accessible bathrooms\n• Elevator access\n\nFor transport: Request accessible vehicles when booking.\n\nEvery traveler deserves a great experience. Let us know your needs!", type: "other" };
  }

  // === GENERAL CATCH-ALL (what/who/tell me) ===
  if (/^(what|who|where|how|when|why|can|is|do|does|are|will|should|tell)/.test(input)) {
    return { response: "Great question! NoLSAF connects your entire African journey in one unified platform 🌍\n\nBook accommodation, add transport to your stay, discover destinations, and pay locally, all seamlessly linked.\n\n🏨 Verified stays across East Africa\n🚗 Integrated transport to/from your accommodation\n🧭 Destination discovery and trip planning\n💳 M-Pesa, cards, bank transfer\n👥 Group bookings & custom itineraries\n\nTry asking something specific like:\n• \"How do I book a property?\"\n• \"Tell me about Zanzibar\"\n• \"What payment methods do you accept?\"\n• \"How do I register as an owner?\"\n\nI'm here to help! 😊", type: "other" };
  }

  // === GOODBYE / CLOSING ===
  if (/(goodbye|bye|see you|farewell|thank|thanks|that'?s all|done|finish|close|end|exit|quit|asante|cheers|got it|great|perfect|okay|ok|cool|nice)/.test(input)) {
    return { response: "Asante sana! (Thank you!) 😊 Glad I could help. I'm always here when you need me, whether it's finding a place to stay, arranging transport, or just exploring East Africa.\n\nKaribu tena! (Welcome again!) Safe travels! 🌍✨", type: "other" };
  }

  // === DEFAULT RESPONSE ===
  return {
    response: "I'm not sure I caught that, but I'm here to help! 🤝\n\nNoLSAF connects accommodation and tourism access in one unified platform. Here's what I can assist with:\n\n🏨 Book verified stays\n🚗 Add transport to your booking (to/from your stay, tours)\n🧭 Discover destinations and plan trips\n💳 Pay with Mpesa, cards, or bank transfer\n👥 Group bookings for families & corporates\n👤 Account, registration & referrals\n\nTry asking:\n• \"How do I book a property?\"\n• \"Tell me about Zanzibar\"\n• \"What payment methods do you accept?\"\n• \"How do I become a property owner?\"",
    type: "default"
  };
}

/**
 * Get the timeout conclusion message when user is inactive
 */
export function getTimeoutMessage(language: string = "en"): string {
  return getTranslation("timeout", language as LanguageCode);
}
