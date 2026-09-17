/**
 * Twiga knowledge registry: customer-facing entries.
 *
 * Migrated from the original `automatedResponses.ts` if-chain, with stale
 * product claims corrected against the codebase:
 *   - Card payments go through AzamPay and CoralCommerce. There is no Stripe
 *     integration anywhere in the API; the old copy said there was.
 *   - Coverage is Tanzania. Kenya was deliberately removed from the public
 *     surface, so Twiga no longer advertises it.
 *   - The mobile app exists and has shipped. The old copy said it was "on our
 *     roadmap" and told users to bookmark the website instead.
 *   - "Plan With Us" was retired in September 2026 and is gone from here.
 *
 * Anything asserted here that could not be confirmed from code carries a
 * `verify` note.
 */

import type { TwigaEntry } from "./types";
import { PRIORITY } from "./types";

export const CUSTOMER_ENTRIES: TwigaEntry[] = [
  // ─── Critical ────────────────────────────────────────────────────────────
  {
    id: "emergency",
    audience: "both",
    priority: PRIORITY.CRITICAL,
    patterns: [
      /\b(emergency|sos|ambulance|police|fire brigade|accident|assaulted|robbed|stolen|in danger|life threatening)\b/,
    ],
    answer: {
      en: "If you are in danger, contact the emergency services first.\n\nTanzania:\nPolice 112 or 999\nFire 114\nAmbulance 114\n\nThen, when you are safe:\n1. Contact your accommodation\n2. Contact your embassy if you are a visitor\n3. Contact your travel insurer\n\nIf this affects a NoLSAF booking, tell me and I will put you straight through to our support team.",
      sw: "Kama uko hatarini, wasiliana na huduma za dharura kwanza.\n\nTanzania:\nPolisi 112 au 999\nZimamoto 114\nGari la wagonjwa 114\n\nUkishakuwa salama:\n1. Wasiliana na mahali unapofikia\n2. Wasiliana na ubalozi wako kama wewe ni mgeni\n3. Wasiliana na bima yako ya safari\n\nKama hili linahusu uhifadhi wa NoLSAF, niambie nitakuunganisha moja kwa moja na timu yetu ya msaada.",
    },
    followUps: ["Talk to a person"],
  },
  {
    id: "human-handoff",
    audience: "both",
    priority: PRIORITY.CRITICAL,
    patterns: [
      /\b(talk|speak|chat) to (a |an )?(human|person|agent|someone|real person|staff)\b/,
      /\b(human|real person|live agent|customer (care|service) (agent|rep))\b/,
      // "property manager" or "my manager booked this" is not a request for support.
      /\b(escalate|(speak|talk) (to|with) (a |the |your )?(supervisor|manager))\b/,
      /\b(nataka|naomba|nahitaji|niunganishe)\s+(kuongea|kuzungumza|kuwasiliana|na)\s+(na\s+)?(mtu|binadamu|wakala|timu|huduma kwa wateja)\b/,
      /\bhuduma kwa wateja\b/,
      /\b(you (are|re) (useless|not helping)|this (bot|is) not help)/,
    ],
    answer: {
      en: "Of course, I will pass this to our support team.\n\nSo they can pick it up quickly, tell me in one message what you need help with, and include your booking reference if it relates to a booking. Someone will reply in this same chat.",
      sw: "Hakuna shida, nitapeleka hili kwa timu yetu ya msaada.\n\nIli waweze kulishughulikia haraka, niambie kwa ujumbe mmoja unahitaji msaada gani, na uweke namba ya uhifadhi wako kama linahusu uhifadhi. Mtu atakujibu hapa hapa kwenye mazungumzo haya.",
    },
    verify: "Phase 3 replaces this copy with the real handoff action once the ticket thread exists.",
  },

  // ─── Conversation ────────────────────────────────────────────────────────
  {
    id: "greeting",
    audience: "customer",
    priority: PRIORITY.CONVERSATION,
    patterns: [
      /^\s*(hi+|hello+|hey+|yo|sup|greetings|good\s*(morning|afternoon|evening))\b/,
      /^\s*(jambo|habari|mambo|niaje|sasa|shikamoo|hujambo|salama|poa)\b/,
      /^\s*(hola|salut|bonjour|ol[aá]|marhaba|ni hao)\b/,
    ],
    answer: {
      en: "Karibu! I am Twiga, your assistant at NoLSAF.\n\nI can help you with:\nFinding and booking a verified place to stay\nAdding transport to get there and get around\nTours and experiences\nPaying with mobile money, card, or bank transfer\nGroup stays for families, teams, and events\nYour bookings and your account\n\nWhat do you need?",
      sw: "Karibu! Mimi ni Twiga, msaidizi wako hapa NoLSAF.\n\nNaweza kukusaidia na:\nKutafuta na kuhifadhi mahali salama pa kufikia\nKuongeza usafiri wa kwenda na kuzunguka\nZiara na matukio\nKulipa kwa simu, kadi, au benki\nMakazi ya kikundi kwa familia, timu, na matukio\nUhifadhi wako na akaunti yako\n\nUnahitaji nini?",
    },
    followUps: [
      "How do I book a property?",
      "What payment methods do you accept?",
      "Tell me about Zanzibar",
    ],
  },
  {
    id: "goodbye",
    audience: "both",
    priority: PRIORITY.CONVERSATION,
    patterns: [
      /^\s*(goodbye|bye|see you|farewell|kwaheri|tutaonana)\b/,
      /^\s*(thank you|thanks|asante|cheers|got it|perfect|great|that is all|that's all)\b/,
    ],
    answer: {
      en: "Asante sana. Glad I could help.\n\nI am here whenever you need me. Safari njema!",
      sw: "Asante sana. Nimefurahi kukusaidia.\n\nNipo wakati wowote utakapohitaji. Safari njema!",
    },
  },

  // ─── Transactional ───────────────────────────────────────────────────────
  {
    id: "booking-status",
    audience: "customer",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(my|the) booking\b/,
      /\bbooking (status|reference|history|confirmation)\b/,
      /\b(where is|track|check on) (my|the) (booking|reservation|stay)\b/,
      /\b(did|has) my booking (go through|been confirmed)\b/,
    ],
    answer: {
      en: "You can see every booking under Account, then My Bookings. Each one shows its reference, current status, the property's contact details, payment status, and your check in and check out dates.\n\nStatus meanings:\nPending, the property has not confirmed yet\nConfirmed, you are all set\nCompleted, your stay has finished\nCancelled, see the refund terms on the booking\n\nIf a booking has been Pending for a long time you can message the property directly from the booking.",
      sw: "Unaweza kuona uhifadhi wako wote chini ya Akaunti, kisha Uhifadhi Wangu. Kila mmoja unaonyesha namba yake, hali yake, mawasiliano ya mwenye nyumba, hali ya malipo, na tarehe zako za kuingia na kutoka.\n\nMaana ya hali:\nInasubiri, mwenye nyumba bado hajathibitisha\nImethibitishwa, kila kitu kipo sawa\nImekamilika, muda wako wa kukaa umeisha\nImeghairiwa, angalia masharti ya kurudishiwa pesa\n\nKama uhifadhi umekaa Inasubiri kwa muda mrefu, unaweza kumtumia ujumbe mwenye nyumba moja kwa moja.",
    },
    links: [{ label: "My Bookings", href: "/account/bookings" }],
    verify: "Confirm /account/bookings is the correct path for the customer bookings list.",
  },
  {
    id: "payment-failed",
    audience: "customer",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\bpayment (failed|declined|error|problem|issue|not working|did not work|didn't work)\b/,
      /\b(paid|payment) but (not|no) (confirm|receipt|booking)\b/,
      /\b(money|pesa) (was |got )?(taken|deducted|debited)\b/,
      /\b(can'?t|cannot|unable to) pay\b/,
    ],
    answer: {
      en: "Sorry about that. Let us sort it out.\n\nIf money left your account but the booking did not confirm, do not pay again. Mobile money confirmations can lag by a few minutes, and the booking updates on its own once the payment clears.\n\nIf it has been longer than that, tell me your booking reference and I will pass this to our support team so they can trace the payment.\n\nIf the payment was declined outright, check that the number or card you used is active and has funds, then try again or use a different method.",
      sw: "Samahani kwa hilo. Turekebishe.\n\nKama pesa imetoka kwenye akaunti yako lakini uhifadhi haujathibitishwa, usilipe tena. Uthibitisho wa malipo ya simu unaweza kuchelewa dakika chache, na uhifadhi hujisasisha wenyewe malipo yakikamilika.\n\nKama imepita muda mrefu zaidi, niambie namba ya uhifadhi wako nitapeleka hili kwa timu yetu ya msaada wafuatilie malipo.\n\nKama malipo yamekataliwa moja kwa moja, hakikisha namba au kadi uliyotumia inafanya kazi na ina pesa, kisha jaribu tena au tumia njia nyingine.",
    },
    followUps: ["Talk to a person"],
  },
  {
    id: "cancellation-refund",
    audience: "customer",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(cancel|cancellation|cancelling)\b/,
      /\b(refund|money back|reimburse)\b/,
      // Someone asking where their money is wants the refund answer, not a
      // booking status. Without this it fell through to a fuzzy tie and landed
      // on whichever transactional entry happened to sort first.
      /\bwhere is my (money|refund|payment)\b/,
      /\b(change|modify|reschedule|move) (my )?(booking|dates|reservation)\b/,
    ],
    answer: {
      en: "To cancel: go to Account, then My Bookings, open the booking and choose Cancel. The refund follows the policy that was shown to you when you booked.\n\nPolicies vary by property:\nFlexible, full refund inside the stated window\nModerate, partial refund depending on timing\nStrict, limited refund once confirmed\n\nRefunds go back to the method you paid with. Mobile money is usually 1 to 3 days, card can take longer depending on your bank.\n\nIf you only want to change your dates rather than cancel, message the property directly from the booking first. That is often easier than cancelling and rebooking.",
      sw: "Kughairi: nenda Akaunti, kisha Uhifadhi Wangu, fungua uhifadhi na uchague Ghairi. Kurudishiwa pesa kunafuata masharti uliyoonyeshwa wakati wa kuhifadhi.\n\nMasharti hutofautiana kulingana na mahali:\nRahisi, unarudishiwa pesa zote ndani ya muda uliotajwa\nWastani, unarudishiwa sehemu kulingana na wakati\nMakali, unarudishiwa kidogo baada ya uthibitisho\n\nPesa hurudishwa kwa njia uliyotumia kulipa. Malipo ya simu huchukua siku 1 hadi 3, kadi inaweza kuchukua muda zaidi kulingana na benki yako.\n\nKama unataka tu kubadilisha tarehe badala ya kughairi, mtumie ujumbe mwenye nyumba kwanza moja kwa moja kutoka kwenye uhifadhi. Mara nyingi ni rahisi zaidi kuliko kughairi na kuhifadhi upya.",
    },
    links: [{ label: "My Bookings", href: "/account/bookings" }],
  },
  {
    id: "account-login",
    audience: "both",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(can'?t|cannot|unable to) (log ?in|sign ?in)\b/,
      /\b(forgot|reset|change) (my )?password\b/,
      /\b(locked out|account locked|otp|two.?factor|2fa|passkey)\b/,
      /\b(update|change) (my )?(profile|email|phone number)\b/,
    ],
    answer: {
      en: "Account help:\n\nCannot sign in? Use Forgot Password on the sign in page. The reset link goes to your email, and OTP codes arrive by SMS.\n\nUpdating your details? Account, then Profile, then Edit.\n\nSecurity: you can turn on two factor authentication, and on the mobile app you can sign in with a passkey and lock the app behind your fingerprint or face.\n\nIf you are locked out and the reset is not reaching you, tell me and I will pass you to support.",
      sw: "Msaada wa akaunti:\n\nHuwezi kuingia? Tumia Umesahau Nenosiri kwenye ukurasa wa kuingia. Kiungo cha kubadilisha kinakwenda kwenye barua pepe yako, na namba za OTP zinafika kwa SMS.\n\nKubadilisha taarifa zako? Akaunti, kisha Wasifu, kisha Hariri.\n\nUsalama: unaweza kuwasha uthibitisho wa hatua mbili, na kwenye programu ya simu unaweza kuingia kwa passkey na kufunga programu kwa alama ya kidole au uso wako.\n\nKama umefungiwa nje na ujumbe wa kubadilisha haukufikii, niambie nitakuunganisha na msaada.",
    },
  },

  // ─── Service ─────────────────────────────────────────────────────────────
  {
    id: "how-to-book",
    audience: "customer",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bhow (can|do) i (book|reserve)\b/,
      /\bhow to (book|reserve|make a (booking|reservation))\b/,
      /\b(booking process|steps to book|i want to book|book now)\b/,
    ],
    exclude: [/\b(group|tour|transport|ride|taxi)\b/],
    answer: {
      en: "Booking a stay:\n\n1. Search by city, region, or property type\n2. Set your dates and how many guests\n3. Pick a room or unit and check the price\n4. Choose how to pay, mobile money, card, or bank transfer\n5. Confirm, and you get a booking reference\n\nYou will get an email confirmation, and the property is notified at the same time so they can message you directly.\n\nFilter by amenities, price range, and what is nearby to narrow things down.",
      sw: "Kuhifadhi mahali pa kukaa:\n\n1. Tafuta kwa mji, mkoa, au aina ya jengo\n2. Weka tarehe zako na idadi ya wageni\n3. Chagua chumba na uangalie bei\n4. Chagua namna ya kulipa, simu, kadi, au benki\n5. Thibitisha, na utapata namba ya uhifadhi\n\nUtapata uthibitisho kwa barua pepe, na mwenye nyumba anajulishwa wakati huo huo ili aweze kukutumia ujumbe moja kwa moja.\n\nChuja kwa huduma zilizopo, kiwango cha bei, na vitu vilivyo karibu ili kupunguza chaguzi.",
    },
    links: [{ label: "Browse properties", href: "/public/properties" }],
    followUps: ["What payment methods do you accept?", "What is the cancellation policy?"],
  },
  {
    id: "payment-methods",
    audience: "both",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(payment method|ways to pay|how (can|do) i pay|what payment)\b/,
      /\b(mpesa|m-pesa|airtel money|mixx|halopesa|halo pesa|tigo pesa|mobile money)\b/,
      /\b(bank transfer|crdb|nmb|nbc)\b/,
      // "visa" on its own is not a card question. On a travel platform someone
      // typing it almost always means an entry visa, so the card reading has to
      // be qualified. "do you accept visa" is still caught by the pattern below.
      /\b(visa card|mastercard|credit card|debit card)\b/,
      /\bdo you (accept|take) \w+/,
    ],
    answer: {
      en: "You can pay with:\n\nMobile money: M-Pesa, Mixx by Yas, Airtel Money, HaloPesa. Usually instant.\nCard: Visa and Mastercard, debit or credit.\nBank transfer: CRDB, NMB, NBC and others, typically used for larger bookings.\n\nYou pick your method at checkout. Mobile money is the fastest option in Tanzania. Prices are shown in Tanzanian Shillings.",
      sw: "Unaweza kulipa kwa:\n\nMalipo ya simu: M-Pesa, Mixx by Yas, Airtel Money, HaloPesa. Kwa kawaida ni papo hapo.\nKadi: Visa na Mastercard, ya benki au ya mkopo.\nUhamisho wa benki: CRDB, NMB, NBC na nyingine, mara nyingi kwa uhifadhi mkubwa.\n\nUnachagua njia yako wakati wa kulipa. Malipo ya simu ndiyo ya haraka zaidi Tanzania. Bei zinaonyeshwa kwa Shilingi ya Tanzania.",
    },
    verify:
      "Confirm the live bank list. Routes exist for AzamPay bank transfers but the named banks are not enumerated in code.",
  },
  {
    id: "transport",
    audience: "customer",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(transport|ride|taxi|pickup|pick up|drop.?off|shuttle)\b/,
      /\b(airport (transfer|pickup|pick up))\b/,
      /\b(car hire|car rental|hire a car)\b/,
      /\bhow (do|can) i get (to|from|there|around)\b/,
      /\binter.?city\b/,
    ],
    answer: {
      en: "Transport on NoLSAF:\n\nAirport transfers, pickup and drop off\nRides around town\nInter city trips\nGroup transport for families and larger parties\n\nYou can add transport to a stay while booking it, or book it on its own. Give the pickup point, the destination, and the date and time. Drivers are verified, and you get their details before the trip.",
      sw: "Usafiri kwenye NoLSAF:\n\nUsafiri wa uwanja wa ndege, kuchukuliwa na kupelekwa\nSafari za mjini\nSafari kati ya miji\nUsafiri wa kikundi kwa familia na makundi makubwa\n\nUnaweza kuongeza usafiri wakati wa kuhifadhi mahali pa kukaa, au kuhifadhi peke yake. Toa mahali pa kuchukuliwa, unakokwenda, na tarehe na saa. Madereva wamehakikiwa, na unapata taarifa zao kabla ya safari.",
    },
  },
  {
    id: "tours",
    audience: "customer",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(tour|tours|excursion|day trip|guided)\b/,
      /\b(book|arrange) (a )?(safari|game drive|experience)\b/,
      /\b(tour operator|tour company|tour booking)\b/,
    ],
    answer: {
      en: "Tours and experiences are bookable on NoLSAF alongside your stay.\n\nYou browse tours, pick a date and the number of people, and book with the same payment methods as everything else. Operators on the platform are verified, and each one carries a rating and an operator level based on their track record.\n\nIf a tour is cancelled you are refunded under the terms shown at booking. Tell me where you are going and I can point you at what is there.",
      sw: "Ziara na matukio yanaweza kuhifadhiwa kwenye NoLSAF pamoja na mahali unapokaa.\n\nUnaangalia ziara, unachagua tarehe na idadi ya watu, na unahifadhi kwa njia zile zile za malipo. Waendeshaji kwenye jukwaa wamehakikiwa, na kila mmoja ana kiwango na daraja kulingana na rekodi yake.\n\nKama ziara itaghairiwa unarudishiwa pesa kwa masharti yaliyoonyeshwa wakati wa kuhifadhi. Niambie unakokwenda nami nitakuelekeza kwenye kilichopo.",
    },
    verify:
      "Confirm customer-visible tour cancellation and refund wording against the tour cancellation scenarios already implemented.",
  },
  {
    id: "group-stay",
    audience: "customer",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bgroup (stay|booking|accommodation|travel|trip|transport)\b/,
      /\b(corporate|team) (booking|retreat|stay|event)\b/,
      /\b(wedding|conference|school trip) (accommodation|booking|venue)?\b/,
      /\b(large group|many rooms|lots of people|\d{2,} (people|guests|rooms))\b/,
    ],
    answer: {
      en: "Group Stay is for larger parties: families, company retreats, weddings, conferences, and school trips.\n\nHow it works: you submit a group request with your dates, headcount, and what you need. Properties respond with offers, you compare them, pick one, and pay a deposit to hold it. After that you manage the passenger list and the arrangements in one place, with a single point of contact instead of chasing rooms one by one.\n\nGroup transport can be arranged alongside it.",
      sw: "Group Stay ni kwa makundi makubwa: familia, mikutano ya makampuni, harusi, makongamano, na safari za shule.\n\nInavyofanya kazi: unawasilisha ombi la kikundi na tarehe zako, idadi ya watu, na unachohitaji. Wenye nyumba wanajibu kwa ofa, unazilinganisha, unachagua moja, na unalipa amana kushikilia. Baada ya hapo unasimamia orodha ya abiria na mipango mahali pamoja, na mtu mmoja wa kuwasiliana naye badala ya kufuatilia vyumba kimoja kimoja.\n\nUsafiri wa kikundi unaweza kupangwa pamoja na hilo.",
    },
    followUps: ["How do I submit a group request?"],
  },
  {
    id: "referrals",
    audience: "both",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(referr?al|refer a friend|invite (a )?friend)\b/,
      /\b(referral (code|link|program|earnings))\b/,
    ],
    answer: {
      en: "Every account has its own referral code. Share it, and when someone signs up with it and completes their first booking, you both benefit.\n\nFind yours under Account, in the Referral section. You can copy the code or share a link straight to WhatsApp or SMS. The same section tracks what you have earned.",
      sw: "Kila akaunti ina namba yake ya rufaa. Igawe, na mtu akijisajili nayo na kukamilisha uhifadhi wake wa kwanza, nyote wawili mnanufaika.\n\nPata yako chini ya Akaunti, sehemu ya Rufaa. Unaweza kunakili namba au kushiriki kiungo moja kwa moja kwenda WhatsApp au SMS. Sehemu hiyo hiyo inafuatilia ulichopata.",
    },
    verify: "Confirm the current referral reward terms. Code grants a benefit but the amount is not stated in code.",
  },
  {
    id: "invoices-receipts",
    audience: "both",
    priority: PRIORITY.SERVICE,
    patterns: [
      // Deliberately excludes VAT, TRA, and fiscal receipts: those are an
      // owner compliance question, answered by `nrms-fiscal-receipts`.
      /\b(invoice|receipt|proof of payment)\b/,
      /\bneed (a )?(receipt|invoice)\b/,
    ],
    answer: {
      en: "Receipts and invoices are issued against your booking and are available from the booking itself. If you need one for a company or for reimbursement, open the booking and download it there.\n\nFor stays at properties that issue fiscal receipts, the receipt comes from the property once your payment is settled.\n\nIf you cannot find the document you need, tell me the booking reference and I will pass it to support.",
      sw: "Risiti na ankara zinatolewa kwa uhifadhi wako na zinapatikana kwenye uhifadhi wenyewe. Kama unahitaji kwa ajili ya kampuni au kurudishiwa gharama, fungua uhifadhi na uipakue hapo.\n\nKwa maeneo yanayotoa risiti za kodi, risiti inatoka kwa mwenye nyumba baada ya malipo yako kukamilika.\n\nKama hupati hati unayohitaji, niambie namba ya uhifadhi nitapeleka kwa msaada.",
    },
    verify: "Confirm which customer-facing surface exposes invoice download, and whether fiscal receipts reach customers directly.",
  },

  // ─── Onboarding ──────────────────────────────────────────────────────────
  {
    id: "signup",
    audience: "customer",
    priority: PRIORITY.ONBOARDING,
    patterns: [
      /\b(sign up|register|create (an )?account|how to join|registration)\b/,
      /\bwhat do i need to book\b/,
      /\b(documents?|requirements?) (needed|to book)\b/,
    ],
    exclude: [/\b(owner|host|landlord|driver|property|partner)\b/],
    answer: {
      en: "Signing up takes about two minutes. You need an email address or a phone number, and a way to pay.\n\nYou verify your email or phone with a one time code, and that is it. No documents needed to book as a guest.\n\nYou can also register as a property owner or as a driver if that is what you are after.",
      sw: "Kujisajili kunachukua kama dakika mbili. Unahitaji barua pepe au namba ya simu, na njia ya kulipa.\n\nUnathibitisha barua pepe au simu yako kwa namba ya mara moja, na ndiyo hiyo. Hakuna hati zinazohitajika kuhifadhi kama mgeni.\n\nUnaweza pia kujisajili kama mwenye nyumba au dereva kama ndiyo unachotaka.",
    },
    links: [{ label: "Create an account", href: "/account/register" }],
  },
  {
    id: "become-owner",
    audience: "both",
    priority: PRIORITY.ONBOARDING,
    patterns: [
      /\b(list|add) (my |a )?(property|hotel|lodge|apartment|house)\b/,
      /\bbecome (an? )?(owner|host)\b/,
      /\bregister (as |my )?(an? )?(owner|host|property)\b/,
      /\bi have a (property|hotel|lodge|apartment|guest house)\b/,
      /\b(owner|host) (registration|account|sign ?up)\b/,
    ],
    answer: {
      en: "Listing your property:\n\n1. Register as an owner\n2. Complete your profile and verify your identity\n3. Add the property, photos, description, amenities, and pricing\n4. Our team reviews the listing\n5. Once approved it goes live\n\nWhat you get: a verified badge, a booking dashboard, direct messaging with guests, payment collection by mobile money, card, and bank, and you set your own prices and cancellation policy.\n\nIf you run a hotel or lodge and want front desk, rooms, rates, and billing handled properly, ask me about NRMS.",
      sw: "Kuorodhesha jengo lako:\n\n1. Jisajili kama mwenye nyumba\n2. Kamilisha wasifu wako na uthibitishe utambulisho wako\n3. Ongeza jengo, picha, maelezo, huduma, na bei\n4. Timu yetu inapitia orodha yako\n5. Ikishakubaliwa inaanza kuonekana\n\nUnachopata: alama ya uhakiki, dashibodi ya uhifadhi, kutuma ujumbe moja kwa moja na wageni, kukusanya malipo kwa simu, kadi, na benki, na unaweka bei zako mwenyewe na masharti yako ya kughairi.\n\nKama unaendesha hoteli au lodge na unataka mapokezi, vyumba, bei, na bili vishughulikiwe vizuri, niulize kuhusu NRMS.",
    },
    links: [{ label: "Register as an owner", href: "/account/register?role=owner" }],
    verify: "Confirm the current listing review turnaround before quoting one. The old copy promised 24 to 48 hours.",
  },
  {
    id: "become-driver",
    audience: "both",
    priority: PRIORITY.ONBOARDING,
    patterns: [
      /\bbecome (a )?driver\b/,
      /\bregister (as )?(a )?driver\b/,
      /\bdriver (registration|account|sign ?up)\b/,
      /\b(drive for|join) nolsaf\b/,
      /\bi (have a car|want to drive)\b/,
    ],
    answer: {
      en: "Joining as a driver:\n\n1. Register with the driver role\n2. Submit your licence and vehicle details\n3. Pass verification\n4. Start receiving trip requests\n\nYou get trips from travellers who have already booked their stay, a dashboard to manage them, and reliable payment. Your vehicle, your schedule.",
      sw: "Kujiunga kama dereva:\n\n1. Jisajili kwa nafasi ya udereva\n2. Wasilisha leseni yako na taarifa za gari\n3. Pitia uhakiki\n4. Anza kupokea maombi ya safari\n\nUnapata safari kutoka kwa wasafiri ambao tayari wamehifadhi mahali pa kukaa, dashibodi ya kuzisimamia, na malipo ya uhakika. Gari lako, ratiba yako.",
    },
    links: [{ label: "Register as a driver", href: "/account/register?role=driver" }],
  },

  // ─── Catalogue ───────────────────────────────────────────────────────────
  {
    id: "properties",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\b(propert(y|ies)|accommodation|hotel|lodge|resort|apartment|villa|guest house|hostel|bungalow|homestay)\b/,
      /\b(where|place|somewhere) to (stay|sleep)\b/,
    ],
    exclude: [/\b(list|add|register|become|my property|i have)\b/],
    answer: {
      en: "NoLSAF lists verified stays: hotels, lodges, apartments, villas, guest houses, bungalows, and homestays.\n\nEvery listing shows verified photos, the exact location on a map, the nightly price, the amenities, which payment methods it takes, and its cancellation policy.\n\nUse the filters for region, price, property type, amenities, and what is nearby. Tell me where you are going and roughly what you want to spend, and I can narrow it down.",
      sw: "NoLSAF inaorodhesha maeneo yaliyohakikiwa: hoteli, lodge, vyumba, villa, nyumba za wageni, bungalow, na nyumba za kuishi na wenyeji.\n\nKila orodha inaonyesha picha zilizohakikiwa, mahali hasa kwenye ramani, bei ya usiku, huduma zilizopo, njia za malipo zinazokubalika, na masharti ya kughairi.\n\nTumia vichujio vya mkoa, bei, aina ya jengo, huduma, na vilivyo karibu. Niambie unakokwenda na kiasi unachotaka kutumia, nami nitakusaidia kupunguza chaguzi.",
    },
    links: [{ label: "Browse properties", href: "/public/properties" }],
  },
  {
    id: "amenities",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\b(amenit(y|ies)|facilit(y|ies)|what is included|what's included)\b/,
      /\b(wifi|parking|swimming pool|breakfast|air conditioning|gym|laundry|hot water)\b/,
    ],
    answer: {
      en: "Each listing shows its full amenity list. Common ones are WiFi, parking, pool, breakfast, air conditioning, gym, restaurant, laundry, kitchen, TV, hot water, and a safe.\n\nUse the amenity filters when searching so you only see places that have what you need.",
      sw: "Kila orodha inaonyesha huduma zake zote. Za kawaida ni WiFi, maegesho, bwawa, kifungua kinywa, kiyoyozi, jimu, mgahawa, kufua nguo, jiko, TV, maji ya moto, na sefu.\n\nTumia vichujio vya huduma wakati wa kutafuta ili uone tu maeneo yenye unachohitaji.",
    },
  },
  {
    id: "pricing",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\b(how much|price|cost|pricing|budget|affordable|cheap|expensive)\b/,
      /\b(discount|promotion|deal|offer)\b/,
    ],
    exclude: [/\b(commission|you (take|charge)|your (fee|cut))\b/],
    answer: {
      en: "Prices are set by each property and shown per night in Tanzanian Shillings, with the amenities included. What you see at checkout is what you pay.\n\nTo find something in your range, filter by price, check whether a place offers a longer stay rate, and compare similar properties in the same area. For bigger parties a group request often gets you a better rate than booking rooms one by one.\n\nTell me your destination and your nightly budget and I will point you in the right direction.",
      sw: "Bei zinawekwa na kila mwenye jengo na zinaonyeshwa kwa usiku kwa Shilingi ya Tanzania, pamoja na huduma zilizomo. Unachokiona wakati wa kulipa ndicho unacholipa.\n\nKupata kitu kwenye kiwango chako, chuja kwa bei, angalia kama mahali kuna bei ya kukaa muda mrefu, na linganisha maeneo yanayofanana katika eneo moja. Kwa makundi makubwa, ombi la kikundi mara nyingi linakupa bei nzuri zaidi kuliko kuhifadhi vyumba kimoja kimoja.\n\nNiambie unakokwenda na bajeti yako ya usiku nami nitakuelekeza.",
    },
    verify:
      "The old copy quoted TZS bands for budget, mid range, and premium. Removed rather than restated, since nothing in code backs those numbers.",
  },
  {
    id: "check-in-out",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\bcheck.?(in|out)\b/,
      /\b(early (arrival|check)|late (departure|check))\b/,
      /\bwhat time (can i|do i) (arrive|leave|check)\b/,
    ],
    answer: {
      en: "Check in and check out times are set by each property and shown on the listing and on your booking confirmation. Most are check in from early afternoon and check out in the late morning.\n\nNeed to arrive early or leave late? Message the property directly from your booking. Many will accommodate it depending on availability, some charge a little extra.",
      sw: "Saa za kuingia na kutoka zinawekwa na kila mwenye jengo na zinaonyeshwa kwenye orodha na kwenye uthibitisho wa uhifadhi wako. Mara nyingi ni kuingia mchana na kutoka asubuhi.\n\nUnahitaji kufika mapema au kuondoka kuchelewa? Mtumie ujumbe mwenye jengo moja kwa moja kutoka kwenye uhifadhi wako. Wengi watakubali kulingana na upatikanaji, wengine wanatoza kidogo.",
    },
  },
  {
    id: "reviews",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\b(review|rating|stars?|feedback|testimonial)\b/,
      /\bis \w+ (any )?good\b/,
    ],
    answer: {
      en: "After a completed stay you can leave a review from Account, My Bookings, on the booking itself. You rate out of five and write what you thought, and properties can respond.\n\nWhen you are choosing a place, read the recent reviews rather than just the average, and look for the verified badge. Reviews only come from guests who actually stayed.",
      sw: "Baada ya kukaa na kumaliza, unaweza kuandika maoni kutoka Akaunti, Uhifadhi Wangu, kwenye uhifadhi wenyewe. Unatoa alama kati ya tano na unaandika ulichofikiri, na wenye majengo wanaweza kujibu.\n\nUnapochagua mahali, soma maoni ya karibuni badala ya wastani tu, na tafuta alama ya uhakiki. Maoni yanatoka kwa wageni waliokaa kweli.",
    },
  },
  {
    id: "nearby",
    audience: "customer",
    priority: PRIORITY.CATALOGUE,
    patterns: [
      /\b(nearby|near me|close to|around me|how far|distance)\b/,
      /\bwhat is (near|around|close)\b/,
    ],
    answer: {
      en: "Listings show what is around them: hospitals, restaurants, cafes, beaches, markets, fuel, bus stations, the airport distance, and nearby attractions.\n\nTo search by distance from you, turn on location, open the filters, enable Nearby Me, and set a radius. Results come back sorted by how close they are.",
      sw: "Orodha zinaonyesha vilivyo karibu nazo: hospitali, migahawa, mikahawa, fukwe, masoko, mafuta, vituo vya mabasi, umbali wa uwanja wa ndege, na vivutio vya karibu.\n\nKutafuta kwa umbali kutoka ulipo, washa eneo, fungua vichujio, washa Karibu Nami, na weka eneo. Matokeo yanarudi yakipangwa kwa ukaribu.",
    },
  },

  // ─── Destinations ────────────────────────────────────────────────────────
  {
    id: "dest-zanzibar",
    audience: "customer",
    priority: PRIORITY.DESTINATION,
    patterns: [
      /\b(zanzibar|unguja|pemba|stone town|nungwi|kendwa|paje|jambiani|matemwe)\b/,
    ],
    answer: {
      en: "Zanzibar:\n\nNungwi, northern beaches, lively\nKendwa, calm water, beachfront lodges\nPaje, kite surfing, laid back\nStone Town, UNESCO heritage, culture and history\nJambiani, quiet and local\nMatemwe, close to Mnemba for diving\nPemba, remote, excellent diving\n\nThings to do: spice tours, snorkelling, dhow cruises, Stone Town walks, Prison Island, Jozani Forest.\n\nSearch Zanzibar to see what is available, and you can add transport from the ferry or the airport to wherever you are staying.",
      sw: "Zanzibar:\n\nNungwi, fukwe za kaskazini, zenye shughuli\nKendwa, maji matulivu, lodge za ufukweni\nPaje, kite surfing, tulivu\nStone Town, urithi wa UNESCO, utamaduni na historia\nJambiani, kimya na cha kienyeji\nMatemwe, karibu na Mnemba kwa kupiga mbizi\nPemba, mbali, kupiga mbizi kuzuri sana\n\nVitu vya kufanya: ziara za viungo, snorkelling, safari za dhow, matembezi ya Stone Town, Prison Island, Msitu wa Jozani.\n\nTafuta Zanzibar kuona kilichopo, na unaweza kuongeza usafiri kutoka kivukoni au uwanja wa ndege hadi unapokaa.",
    },
    links: [{ label: "Stays in Zanzibar", href: "/public/properties?q=Zanzibar" }],
    verify: "Confirm the properties search query parameter before shipping these destination deep links.",
  },
  {
    id: "dest-dar",
    audience: "customer",
    priority: PRIORITY.DESTINATION,
    patterns: [
      /\b(dar es salaam|dar|dsm|kariakoo|masaki|oyster bay|mikocheni|kigamboni|bongoyo)\b/,
    ],
    answer: {
      en: "Dar es Salaam:\n\nMasaki and Oyster Bay, upmarket, restaurants, ocean views\nCity centre, business and markets\nMikocheni, residential and quieter, good mid range stays\nKigamboni, by the beach\nBongoyo Island, easy day trip\n\nDar is where most trips start. The ferry to Zanzibar takes about two hours, and Julius Nyerere International connects to the rest of the country. Airport transfers are bookable with your stay.",
      sw: "Dar es Salaam:\n\nMasaki na Oyster Bay, za kifahari, migahawa, mandhari ya bahari\nKatikati ya mji, biashara na masoko\nMikocheni, za makazi na tulivu, maeneo mazuri ya bei ya kati\nKigamboni, ufukweni\nKisiwa cha Bongoyo, safari rahisi ya siku moja\n\nDar ndipo safari nyingi zinaanzia. Kivuko kwenda Zanzibar kinachukua kama saa mbili, na Julius Nyerere International inaunganisha na nchi nzima. Usafiri wa uwanja wa ndege unaweza kuhifadhiwa pamoja na mahali unapokaa.",
    },
  },
  {
    id: "dest-northern",
    audience: "customer",
    priority: PRIORITY.DESTINATION,
    patterns: [
      /\b(arusha|moshi|kilimanjaro|serengeti|ngorongoro|tarangire|lake manyara|northern circuit)\b/,
    ],
    answer: {
      en: "Northern Tanzania:\n\nKilimanjaro, the highest peak in Africa at 5,895m, treks run five to nine days from Moshi\nSerengeti, the Great Migration and the Big Five\nNgorongoro Crater, extraordinary density of wildlife\nTarangire, elephants and baobabs\nLake Manyara, flamingos and tree climbing lions\nArusha, the gateway town and the base for most safaris\n\nMost people base themselves in Arusha and arrange game drives from there. We have lodges and hotels across the circuit, and tours are bookable alongside them.",
      sw: "Kaskazini mwa Tanzania:\n\nKilimanjaro, kilele kirefu zaidi Afrika chenye mita 5,895, safari zinachukua siku tano hadi tisa kutoka Moshi\nSerengeti, Uhamiaji Mkuu na Wanyama Watano Wakubwa\nNgorongoro Crater, wanyama wengi wa ajabu\nTarangire, tembo na mibuyu\nLake Manyara, flamingo na simba wanaopanda miti\nArusha, mji wa lango na kituo cha safari nyingi\n\nWatu wengi hukaa Arusha na kupanga safari za wanyama kutoka hapo. Tuna lodge na hoteli katika eneo lote, na ziara zinaweza kuhifadhiwa pamoja nazo.",
    },
  },
  {
    id: "dest-tanzania",
    audience: "customer",
    priority: PRIORITY.DESTINATION,
    patterns: [
      /\b(tanzania|tanzanian|dodoma|mwanza|mbeya|iringa|morogoro|tanga|mtwara|tabora|lake victoria|selous|nyerere national|ruaha|mikumi|udzungwa|bagamoyo)\b/,
      /\bwhere (should|can) i (go|visit|travel)\b/,
      /\b(best|top|popular) (place|destination)\b/,
    ],
    answer: {
      en: "Tanzania has a lot more than the famous names:\n\nDodoma, the capital\nMwanza, on Lake Victoria\nMbeya, highlands and coffee country\nMorogoro, the Uluguru mountains and the way into Mikumi\nNyerere, formerly Selous, the largest reserve in Africa\nRuaha, remote and uncrowded\nUdzungwa, rainforest hiking\nTanga and Bagamoyo, quiet coast and history\n\nGood combinations: Zanzibar with Serengeti for beach and safari, Kilimanjaro with Zanzibar for climb then recover, or Dar with Arusha and Zanzibar for the full run.\n\nWhat kind of trip are you after?",
      sw: "Tanzania ina mengi zaidi ya majina maarufu:\n\nDodoma, makao makuu\nMwanza, kwenye Ziwa Victoria\nMbeya, nyanda za juu na kahawa\nMorogoro, milima ya Uluguru na njia ya kuingia Mikumi\nNyerere, zamani Selous, hifadhi kubwa kuliko zote Afrika\nRuaha, mbali na yenye watu wachache\nUdzungwa, matembezi ya msitu wa mvua\nTanga na Bagamoyo, pwani tulivu na historia\n\nMchanganyiko mzuri: Zanzibar na Serengeti kwa fukwe na wanyama, Kilimanjaro na Zanzibar kwa kupanda kisha kupumzika, au Dar na Arusha na Zanzibar kwa safari kamili.\n\nUnataka safari ya aina gani?",
    },
  },
  {
    id: "safari",
    audience: "customer",
    priority: PRIORITY.DESTINATION,
    patterns: [
      /\b(safari|game drive|wildlife|big five|migration|national park|game reserve)\b/,
      /\b(lion|elephant|rhino|leopard|wildebeest|zebra|giraffe|flamingo)\b/,
    ],
    exclude: [/\bsafari njema\b/],
    answer: {
      en: "Safari in Tanzania:\n\nSerengeti, the Great Migration and the Big Five\nNgorongoro Crater, the densest wildlife viewing in the country\nTarangire, elephant herds and baobabs\nRuaha and Nyerere, remote and much quieter\n\nTypes: game drives, walking safaris, balloon safaris, and camping safaris.\n\nBest viewing is the dry seasons, June to October and December to February. Book a lodge as your base and add the game drives, or book a tour that packages both.",
      sw: "Safari za wanyama Tanzania:\n\nSerengeti, Uhamiaji Mkuu na Wanyama Watano Wakubwa\nNgorongoro Crater, wanyama wengi zaidi nchini\nTarangire, makundi ya tembo na mibuyu\nRuaha na Nyerere, mbali na tulivu zaidi\n\nAina: safari za gari, za miguu, za puto, na za kambi.\n\nWakati mzuri zaidi ni majira ya kiangazi, Juni hadi Oktoba na Desemba hadi Februari. Hifadhi lodge kama kituo chako kisha ongeza safari za wanyama, au hifadhi ziara inayojumuisha vyote.",
    },
  },

  // ─── Travel info ─────────────────────────────────────────────────────────
  {
    id: "best-time",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(best time|when to (visit|go|travel)|weather|season|climate|rainy|dry season)\b/,
    ],
    answer: {
      en: "When to visit Tanzania:\n\nJune to October, cool and dry, the best wildlife viewing and the peak season\nDecember to February, warm and dry, good all round\nMarch to May, the long rains, lush and much cheaper\nNovember, short rains, usually manageable\n\nBeaches work year round. Kilimanjaro is best January to March and June to October. The Great Migration is in the Serengeti roughly July to October.\n\nWet season means fewer people and lower prices, dry season means better sightings.",
      sw: "Wakati wa kutembelea Tanzania:\n\nJuni hadi Oktoba, baridi na kavu, wanyama wanaonekana vizuri zaidi na ni msimu wa watu wengi\nDesemba hadi Februari, joto na kavu, nzuri kwa kila kitu\nMachi hadi Mei, masika, kijani na bei nafuu zaidi\nNovemba, vuli, kwa kawaida si shida\n\nFukwe ni nzuri mwaka mzima. Kilimanjaro ni bora Januari hadi Machi na Juni hadi Oktoba. Uhamiaji Mkuu upo Serengeti kuanzia Julai hadi Oktoba.\n\nMsimu wa mvua una watu wachache na bei nafuu, msimu wa kiangazi una wanyama wanaoonekana vizuri.",
    },
  },
  {
    id: "visa",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(visa|passport|immigration|entry requirement|travel document|permit to enter)\b/,
    ],
    answer: {
      en: "Entry to Tanzania:\n\nYour passport should be valid for at least six months from the date you arrive.\n\nMost nationalities can get a visa on arrival or apply for an e-visa in advance through the official immigration service. There is also an East Africa Tourist Visa that covers multiple countries in the region.\n\nRequirements change, so check the official Tanzanian immigration site and your own government's travel advice before you fly. I would rather you verify than take my word for it.",
      sw: "Kuingia Tanzania:\n\nPasipoti yako inatakiwa iwe halali kwa angalau miezi sita kutoka siku unayowasili.\n\nRaia wa nchi nyingi wanaweza kupata viza wakiwasili au kuomba e-visa mapema kupitia idara rasmi ya uhamiaji. Kuna pia Viza ya Utalii ya Afrika Mashariki inayohusisha nchi kadhaa za ukanda.\n\nMasharti hubadilika, hivyo angalia tovuti rasmi ya uhamiaji Tanzania na ushauri wa serikali yako kabla ya kusafiri. Ni bora uhakikishe kuliko kuniamini mimi.",
    },
    verify: "Visa fees deliberately not quoted. The old copy stated 50 USD and 100 USD, which goes stale and is not ours to promise.",
  },
  {
    id: "health",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(vaccination|vaccine|yellow fever|malaria|health|hospital|pharmacy|mosquito|travel insurance)\b/,
    ],
    answer: {
      en: "Health notes for Tanzania:\n\nYellow fever, a certificate is often required depending on where you are travelling from\nMalaria, take prophylaxis, use repellent and a net\nWater, drink bottled or filtered\nSun, it is stronger than you expect\n\nCommonly recommended: yellow fever, hepatitis A and B, typhoid, and your routine vaccines.\n\nSee a travel clinic four to six weeks before you go, and take out travel insurance. Bring your own prescriptions, pharmacies here may not stock everything. I am not a medical service, so please confirm all of this with a doctor.",
      sw: "Taarifa za afya kwa Tanzania:\n\nHoma ya manjano, cheti mara nyingi kinahitajika kulingana na unakotoka\nMalaria, tumia dawa za kinga, dawa ya mbu na chandarua\nMaji, kunywa ya chupa au yaliyochujwa\nJua, ni kali kuliko unavyotegemea\n\nZinazoshauriwa mara nyingi: homa ya manjano, hepatitis A na B, typhoid, na chanjo zako za kawaida.\n\nOna kliniki ya safari wiki nne hadi sita kabla ya kwenda, na kata bima ya safari. Beba dawa zako mwenyewe, maduka ya dawa hapa yanaweza yasiwe na kila kitu. Mimi si huduma ya matibabu, hivyo tafadhali thibitisha haya yote na daktari.",
    },
  },
  {
    id: "money",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(currency|exchange rate|forex|shilling|tzs|atm|cash|tipping|how much to tip)\b/,
    ],
    exclude: [/\b(payment method|how (can|do) i pay|mpesa|m-pesa)\b/],
    answer: {
      en: "Money in Tanzania:\n\nThe currency is the Tanzanian Shilling. US dollars are widely accepted in tourist areas, bring clean notes printed after 2006.\n\nATMs are in all the major towns and take Visa and Mastercard. Mobile money is everywhere and is easier than cash for most things. Change money at banks or licensed bureaux, not on the street.\n\nTipping is customary but not obligatory: guides and drivers per day, and around five to ten percent in restaurants if no service charge has been added.",
      sw: "Pesa Tanzania:\n\nSarafu ni Shilingi ya Tanzania. Dola za Marekani zinakubalika sana maeneo ya watalii, beba noti safi zilizochapishwa baada ya 2006.\n\nATM zipo miji yote mikubwa na zinakubali Visa na Mastercard. Malipo ya simu yapo kila mahali na ni rahisi kuliko fedha taslimu kwa mambo mengi. Badilisha pesa benki au kwenye maduka yenye leseni, si barabarani.\n\nKutoa bakshishi ni desturi lakini si lazima: waongozaji na madereva kwa siku, na kama asilimia tano hadi kumi mgahawani kama hakuna gharama ya huduma iliyoongezwa.",
    },
    verify: "Exchange rates removed. The old copy hardcoded 2,500 TZS to the dollar, which drifts.",
  },
  {
    id: "connectivity",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(sim card|mobile data|roaming|internet|network coverage|stay connected)\b/,
    ],
    exclude: [/\bwifi\b.*\b(amenit|includ|filter)\b/],
    answer: {
      en: "Staying connected:\n\nA local SIM is cheap and by far the easiest option. Buy one at the airport or any phone shop, you will need your passport to register it. Vodacom, Airtel, Tigo, and Halotel all work well, and data bundles are inexpensive.\n\nWiFi is normal in city hotels and restaurants. Safari lodges usually have it but it can be slow, and in remote parks there is often no coverage at all.\n\nDownload offline maps before you head out on safari.",
      sw: "Kubaki na mawasiliano:\n\nLaini ya hapa ni nafuu na ndiyo njia rahisi zaidi. Nunua uwanja wa ndege au duka lolote la simu, utahitaji pasipoti yako kuisajili. Vodacom, Airtel, Tigo, na Halotel zote zinafanya kazi vizuri, na vifurushi vya data ni nafuu.\n\nWiFi ni ya kawaida kwenye hoteli na migahawa ya mjini. Lodge za safari kwa kawaida zinayo lakini inaweza kuwa ya polepole, na kwenye hifadhi za mbali mara nyingi hakuna mtandao kabisa.\n\nPakua ramani za nje ya mtandao kabla ya kwenda safari ya wanyama.",
    },
  },
  {
    id: "packing",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [/\b(what to (pack|bring|wear)|packing list|luggage|dress code)\b/],
    answer: {
      en: "Packing:\n\nSafari, neutral colours, long sleeves and trousers for sun and mosquitoes, binoculars, a camera, and comfortable shoes\nBeach, swimwear, strong sunscreen, light cotton, a hat, and something to cover up in Stone Town and villages\nKilimanjaro or the highlands, proper layers, a warm jacket, waterproofs, and broken in boots\n\nAlways: passport, insurance documents, a Type D or G adapter, a torch, and insect repellent.",
      sw: "Kufunga mizigo:\n\nSafari ya wanyama, rangi zisizong'aa, mikono mirefu na suruali kwa jua na mbu, darubini, kamera, na viatu vya starehe\nUfukweni, nguo za kuogelea, dawa kali ya jua, pamba nyepesi, kofia, na kitu cha kujifunika Stone Town na vijijini\nKilimanjaro au nyanda za juu, nguo za tabaka, koti la joto, nguo za mvua, na buti ulizozoea\n\nSiku zote: pasipoti, hati za bima, adapta ya aina D au G, tochi, na dawa ya mbu.",
    },
  },
  {
    id: "language",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [/\b(swahili|kiswahili|local language|useful phrases|do (they|people) speak english)\b/],
    answer: {
      en: "Swahili and English are both widely spoken. A few words go a long way:\n\nJambo or Habari, hello\nMambo or Niaje, hey, casual\nShikamoo, respectful greeting to an elder\nAsante sana, thank you very much\nKaribu, welcome, and you are welcome\nTafadhali, please\nPole, sorry\nHakuna matata, no problem\nNdio and Hapana, yes and no\nBei gani, how much\nMaji, water\n\nPeople genuinely appreciate the effort.",
      sw: "Kiswahili na Kiingereza vyote vinazungumzwa sana. Maneno machache yanasaidia sana:\n\nJambo au Habari\nMambo au Niaje, kirafiki\nShikamoo, salamu ya heshima kwa mkubwa\nAsante sana\nKaribu\nTafadhali\nPole\nHakuna matata\nNdio na Hapana\nBei gani\nMaji\n\nWatu wanathamini sana jitihada hiyo.",
    },
  },
  {
    id: "food",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(food|restaurant|dining|cuisine|what to eat|street food|vegetarian|vegan|halal|dietary)\b/,
    ],
    answer: {
      en: "Food worth trying:\n\nUgali with stew, the staple\nNyama choma, grilled meat\nPilau and biryani, spiced rice\nChapati\nGrilled fish, especially on the coast\nCoconut curries, a Zanzibar speciality\nZanzibar pizza and the night market at Forodhani\n\nVegetarian, vegan, and halal are widely catered for. Mention dietary needs when you book if meals are included.\n\nFor street food, pick the busy stalls. High turnover means fresh.",
      sw: "Vyakula vya kujaribu:\n\nUgali na mchuzi, chakula kikuu\nNyama choma\nPilau na biriani\nChapati\nSamaki wa kuchoma, hasa pwani\nMchuzi wa nazi, maarufu Zanzibar\nPizza ya Zanzibar na soko la usiku Forodhani\n\nVyakula vya mboga, vegan, na halali vinapatikana sana. Taja mahitaji yako ya chakula wakati wa kuhifadhi kama milo imejumuishwa.\n\nKwa chakula cha barabarani, chagua vibanda vyenye watu wengi. Wateja wengi maana yake chakula kipya.",
    },
  },
  {
    id: "culture",
    audience: "customer",
    priority: PRIORITY.TRAVEL_INFO,
    patterns: [
      /\b(culture|cultural|tradition|maasai|masai|heritage|local experience|authentic)\b/,
    ],
    answer: {
      en: "Cultural experiences:\n\nMaasai village visits\nStone Town, UNESCO heritage, Swahili architecture and the carved doors\nSpice farm tours in Zanzibar\nLocal markets, Kariakoo in Dar is the big one\nCooking classes, pilau, ugali, chapati\nCoffee plantation tours around Arusha and Kilimanjaro\nHistorical sites at Bagamoyo and the Kilwa ruins\n\nOne request: ask before photographing people, and dress modestly in Stone Town and in villages.",
      sw: "Matukio ya kiutamaduni:\n\nKutembelea vijiji vya Wamaasai\nStone Town, urithi wa UNESCO, ujenzi wa Kiswahili na milango ya nakshi\nZiara za mashamba ya viungo Zanzibar\nMasoko ya kienyeji, Kariakoo Dar ndilo kubwa\nMadarasa ya kupika, pilau, ugali, chapati\nZiara za mashamba ya kahawa Arusha na Kilimanjaro\nMaeneo ya kihistoria Bagamoyo na magofu ya Kilwa\n\nOmbi moja: uliza kabla ya kupiga picha watu, na vaa kwa heshima Stone Town na vijijini.",
    },
  },

  // ─── Brand ───────────────────────────────────────────────────────────────
  {
    id: "about-nolsaf",
    audience: "both",
    priority: PRIORITY.BRAND,
    patterns: [
      /\bwhat (is|does) nolsaf\b/,
      /\b(about nolsaf|tell me about nolsaf|who is nolsaf|explain nolsaf)\b/,
      /\bnolsaf (stand|mean|acronym|abbreviation)\b/,
      /\bwhat (is this|do you do) (platform|site|app)?\b/,
      // The bare brand name. Sits at BRAND priority so anything more specific
      // still wins ("drive for nolsaf" goes to driver registration, "pay on
      // nolsaf" to payments); this is the reading of last resort, and without
      // it the word fell through to the fuzzy pass and matched whichever
      // unrelated pattern happened to mention the brand.
      /\bnolsaf\b/,
    ],
    answer: {
      // The acronym is never spelled out. It is internal, and Twiga is a public
      // surface. Asking what it stands for gets what the product does instead,
      // which is what the person actually wants to know.
      en: "NoLSAF connects your whole trip in one place.\n\nThe idea is simple: accommodation and the travel around it should be one thing, not five apps. Book a verified place to stay, add the transport to get there and move around, book the tours, and pay with mobile money, all connected.\n\nPlanning a Serengeti trip? Book the lodge, add the transport, arrange the game drives, pay with M-Pesa. No switching between services and hoping they line up.\n\nWe operate in Tanzania, built for how people here actually travel and actually pay.",
      sw: "NoLSAF inaunganisha safari yako yote mahali pamoja.\n\nWazo ni rahisi: mahali pa kukaa na safari inayohusiana navyo vinatakiwa kuwa kitu kimoja, si programu tano. Hifadhi mahali salama pa kukaa, ongeza usafiri wa kwenda na kuzunguka, hifadhi ziara, na lipa kwa simu, vyote vikiwa vimeunganishwa.\n\nUnapanga safari ya Serengeti? Hifadhi lodge, ongeza usafiri, panga safari za wanyama, lipa kwa M-Pesa. Bila kuhama kutoka huduma moja kwenda nyingine ukitumaini zitalingana.\n\nTunafanya kazi Tanzania, tumejengwa kulingana na jinsi watu hapa wanavyosafiri na wanavyolipa kweli.",
    },
  },
  {
    id: "who-is-twiga",
    audience: "both",
    priority: PRIORITY.BRAND,
    patterns: [
      /\b(who are you|your name|what are you)\b/,
      /\btwiga\b/,
      /\bare you (a |an )?(bot|ai|robot|human|real|person)\b/,
      /\bwhat can you do\b/,
    ],
    answer: {
      en: "I am Twiga, the assistant here at NoLSAF. Twiga is Swahili for giraffe, which felt right: a giraffe sees a long way across the savanna, and my job is to give you a clear view of your options.\n\nTo be straight with you, I am a bot, not a person. I can help with bookings, payments, cancellations, transport, tours, group stays, destinations, and your account. When I cannot help, I will hand you to a human rather than waste your time.\n\nWhat do you need?",
      sw: "Mimi ni Twiga, msaidizi hapa NoLSAF. Twiga ni jina la mnyama anayeona mbali kwenye uwanda, na kazi yangu ni kukupa mtazamo wazi wa chaguzi zako.\n\nNikuambie ukweli, mimi ni roboti, si mtu. Naweza kusaidia na uhifadhi, malipo, kughairi, usafiri, ziara, makazi ya kikundi, maeneo, na akaunti yako. Nisipoweza kusaidia, nitakuunganisha na mtu badala ya kupoteza muda wako.\n\nUnahitaji nini?",
    },
  },
  {
    id: "trust-safety",
    audience: "both",
    priority: PRIORITY.BRAND,
    patterns: [
      // "is nolsaf safe", "is this site legit", "are you real". The subject is
      // left open so the brand name in the middle does not send the question to
      // the general brand answer instead.
      /\bis \w+ (safe|real|legit|legitimate|a scam|trustworthy)\b/,
      /\b(is (it|this) (safe|real|legit|legitimate|a scam)|are you (legit|real|a scam))\b/,
      /\b(scam|fraud|trust|trustworthy|reliable|verified|verification|safety|secure)\b/,
      /\bhow do i know\b.*\b(real|safe|trust)\b/,
    ],
    answer: {
      en: "Fair question, ask it more often.\n\nEvery property is verified before it can be listed. We check ownership and the photos, so what you see is the place you get. Payments are processed through licensed providers, never handed to the property directly. Cancellation terms are shown before you pay, not buried afterwards. Reviews only come from guests who actually stayed.\n\nIf a listing looks wrong to you, report it and we will investigate. If something has already gone wrong with a booking, tell me and I will get a person on it.",
      sw: "Swali zuri, liulizwe mara nyingi zaidi.\n\nKila jengo linahakikiwa kabla halijaorodheshwa. Tunathibitisha umiliki na picha, hivyo unachokiona ndicho unachopata. Malipo yanapitia watoa huduma wenye leseni, hayapewi mwenye jengo moja kwa moja. Masharti ya kughairi yanaonyeshwa kabla hujalipa, si kufichwa baadaye. Maoni yanatoka kwa wageni waliokaa kweli.\n\nKama orodha inaonekana si sahihi, ripoti nasi tutachunguza. Kama tayari kuna tatizo kwenye uhifadhi, niambie nitampata mtu alishughulikie.",
    },
  },
  {
    id: "commission",
    audience: "both",
    priority: PRIORITY.BRAND,
    patterns: [
      /\b(commission|platform fee|service (fee|charge))\b/,
      /\bhow (do|does) (you|nolsaf) (make|earn) money\b/,
      /\bhow much (do )?(you|nolsaf) (take|charge)\b/,
      /\bbusiness model\b/,
    ],
    answer: {
      en: "NoLSAF takes a commission on completed bookings. That is what funds verification, payment processing, support, and the platform itself.\n\nGuests are not charged a separate booking fee. The price you see on a listing is the price you pay.\n\nFor owners, the exact rate is shown during registration and in your dashboard, and you keep control of your own pricing and cancellation policy.",
      sw: "NoLSAF inachukua kamisheni kwenye uhifadhi uliokamilika. Ndicho kinachogharamia uhakiki, usindikaji wa malipo, msaada, na jukwaa lenyewe.\n\nWageni hawatozwi ada tofauti ya kuhifadhi. Bei unayoiona kwenye orodha ndiyo unayolipa.\n\nKwa wenye majengo, kiwango kamili kinaonyeshwa wakati wa kujisajili na kwenye dashibodi yako, na unabaki na udhibiti wa bei zako na masharti yako ya kughairi.",
    },
    verify:
      "Rate deliberately not quoted. It is configurable via SystemSetting.commissionPercent, so any number written here would go stale.",
  },

  // ─── General ─────────────────────────────────────────────────────────────
  {
    id: "nrms-for-visitors",
    audience: "customer",
    priority: PRIORITY.BRAND,
    patterns: [/\bnrms\b/],
    answer: {
      en: "NRMS is our system for the properties themselves, not for booking a stay.\n\nIt is what a hotel or lodge uses to run its front desk, rooms and rates, housekeeping, restaurant and bar, and its accounts. Properties running on it tend to be quicker to confirm and better organised when you arrive.\n\nIf you run a property and want to know more, say so and I will go through it properly.",
      sw: "NRMS ni mfumo wetu kwa ajili ya majengo yenyewe, si wa kuhifadhi mahali pa kukaa.\n\nNdio hoteli au lodge inaotumia kuendesha mapokezi, vyumba na bei, usafi, mgahawa na baa, na hesabu zake. Maeneo yanayotumia mfumo huu huwa yanathibitisha haraka na yamepangwa vizuri unapowasili.\n\nKama unaendesha jengo na unataka kujua zaidi, niambie nitakueleza kwa kina.",
    },
    links: [{ label: "About NRMS", href: "/nrms" }],
    followUps: ["I run a property, tell me more"],
  },
  {
    id: "mobile-app",
    audience: "both",
    priority: PRIORITY.GENERAL,
    patterns: [
      /\b(mobile app|the app|download|android|ios|iphone|play store|app store|install)\b/,
    ],
    answer: {
      en: "Yes, there is a NoLSAF mobile app as well as the website.\n\nOn the app you can browse and book, manage your bookings, message properties, and sign in with a passkey instead of a password. You can also lock the app behind your fingerprint or face so your bookings and payment details stay private if someone else picks up your phone.\n\nEverything also works in a mobile browser if you would rather not install anything.",
      sw: "Ndiyo, kuna programu ya simu ya NoLSAF pamoja na tovuti.\n\nKwenye programu unaweza kuangalia na kuhifadhi, kusimamia uhifadhi wako, kutuma ujumbe kwa wenye majengo, na kuingia kwa passkey badala ya nenosiri. Unaweza pia kufunga programu kwa alama ya kidole au uso wako ili uhifadhi wako na taarifa za malipo zibaki salama kama mtu mwingine atashika simu yako.\n\nKila kitu pia kinafanya kazi kwenye kivinjari cha simu kama hutaki kusakinisha chochote.",
    },
    verify: "Confirm store availability and the correct store links before adding them here.",
  },
  {
    id: "accessibility",
    audience: "customer",
    priority: PRIORITY.GENERAL,
    patterns: [
      /\b(accessible|accessibility|wheelchair|disability|disabled|mobility|special needs)\b/,
    ],
    answer: {
      en: "Accessibility varies by property, so check the listing description and confirm directly with the place before you book. Add your requirements to the booking notes as well.\n\nCommonly available: ground floor rooms, ramps, accessible bathrooms, and lifts. For transport, ask for an accessible vehicle when you book rather than on the day.\n\nIf you tell me what you need, I can pass it to support and have them check with specific properties for you.",
      sw: "Upatikanaji hutofautiana kulingana na jengo, hivyo angalia maelezo ya orodha na uthibitishe moja kwa moja na mahali kabla ya kuhifadhi. Ongeza mahitaji yako kwenye maelezo ya uhifadhi pia.\n\nZinazopatikana mara nyingi: vyumba vya chini, njia za magurudumu, bafu zinazofikika, na lifti. Kwa usafiri, omba gari linalofikika wakati wa kuhifadhi si siku yenyewe.\n\nUkiniambia unachohitaji, naweza kupeleka kwa msaada wakaulize maeneo maalum kwa niaba yako.",
    },
  },
  {
    id: "family",
    audience: "customer",
    priority: PRIORITY.GENERAL,
    patterns: [
      /\b(family friendly|child friendly|travel(ling)? with kids|with children|cot|crib|baby|infant)\b/,
    ],
    answer: {
      en: "Travelling with children:\n\nFilter for family friendly properties, many have cots available, and restaurants generally cater for children. Ask for child seats when booking transport, not on the day. For a larger family a group request is often better value than separate rooms.\n\nMost parks welcome children on game drives. Walking safaris and some activities have minimum ages, usually in the teens, so check with the operator before you commit.",
      sw: "Kusafiri na watoto:\n\nChuja maeneo yanayofaa familia, mengi yana vitanda vya watoto, na migahawa kwa kawaida ina chakula cha watoto. Omba viti vya watoto wakati wa kuhifadhi usafiri, si siku yenyewe. Kwa familia kubwa, ombi la kikundi mara nyingi lina bei nzuri kuliko vyumba tofauti.\n\nHifadhi nyingi zinakaribisha watoto kwenye safari za gari. Safari za miguu na baadhi ya matukio yana umri wa chini, kwa kawaida miaka ya utineja, hivyo hakikisha na mwendeshaji kabla ya kuamua.",
    },
  },
  {
    id: "contact-support",
    audience: "both",
    priority: PRIORITY.GENERAL,
    patterns: [
      /\b(contact|reach) (you|support|customer service|the team)\b/,
      /\b(support|customer service|help) (team|email|number|line)\b/,
    ],
    exclude: [/\b(talk|speak) to (a |an )?(human|person|agent|someone)\b/],
    answer: {
      en: "You can reach our team from your account dashboard under Support, or from a specific booking if it is about that booking.\n\nFor anything about a property itself, messaging the owner directly from the booking is usually fastest.\n\nOr just tell me what is wrong here and I will pass it straight to support without you having to fill in a form.",
      sw: "Unaweza kufikia timu yetu kutoka kwenye dashibodi ya akaunti yako chini ya Msaada, au kutoka kwenye uhifadhi maalum kama ni kuhusu uhifadhi huo.\n\nKwa lolote kuhusu jengo lenyewe, kumtumia ujumbe mwenye jengo moja kwa moja kutoka kwenye uhifadhi mara nyingi ni haraka zaidi.\n\nAu niambie tu tatizo ni nini hapa nami nitapeleka moja kwa moja kwa msaada bila wewe kujaza fomu.",
    },
    followUps: ["Talk to a person"],
  },
];
