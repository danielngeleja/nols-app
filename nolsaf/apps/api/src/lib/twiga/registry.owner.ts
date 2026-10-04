/**
 * Twiga knowledge registry: owner and NRMS entries.
 *
 * The original bot knew nothing about any of this, which meant the most
 * complex part of the product had no support surface at all.
 *
 * Labels and paths here are taken from the live navigation
 * (apps/web/components/OwnerSidebar.tsx and app/(owner)/owner/nrms/layout.tsx)
 * rather than invented, so the deep links match what the owner actually sees.
 *
 * Two things are deliberately not promised:
 *   - NRMS pricing numbers. Billing runs off a usage policy configured at
 *     activation, so any figure written here would be wrong for someone.
 *   - Working TRA fiscal receipting. The VFD adapter is not built yet, it
 *     waits on TRA's own specification, so Twiga says so plainly.
 */

import type { TwigaEntry } from "./types";
import { PRIORITY } from "./types";

export const OWNER_ENTRIES: TwigaEntry[] = [
  // ─── Conversation ────────────────────────────────────────────────────────
  {
    id: "owner-greeting",
    audience: "owner",
    priority: PRIORITY.CONVERSATION,
    patterns: [
      /^\s*(hi+|hello+|hey+|yo|greetings|good\s*(morning|afternoon|evening))\b/,
      /^\s*(jambo|habari|mambo|niaje|sasa|shikamoo|hujambo|salama|poa)\b/,
    ],
    answer: {
      en: "Karibu! I am Twiga, your assistant at NoLSAF.\n\nI can help you with:\nYour listings and getting them approved\nBookings, check in and check out\nYour revenue, invoices, and payouts\nGroup stay claims\nThe NRMS workspace, front desk, rooms, rates, housekeeping, food and drink, finance\nYour account and staff access\n\nWhat do you need?",
      sw: "Karibu! Mimi ni Twiga, msaidizi wako hapa NoLSAF.\n\nNaweza kukusaidia na:\nOrodha zako na kuzipitisha\nUhifadhi, kuingia na kutoka kwa wageni\nMapato yako, ankara, na malipo\nMadai ya makazi ya kikundi\nEneo la kazi la NRMS, mapokezi, vyumba, bei, usafi, chakula na vinywaji, fedha\nAkaunti yako na ufikiaji wa wafanyakazi\n\nUnahitaji nini?",
    },
    followUps: [
      "Why is my property still pending?",
      "When do I get paid?",
      "What is NRMS?",
    ],
  },

  // ─── Listings and approval ───────────────────────────────────────────────
  {
    id: "owner-listing-approval",
    audience: "owner",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(my|the) (property|listing) (is |still )?(pending|not approved|under review|not live|not showing)\b/,
      /\b(why|when) (is|will) my (property|listing)\b/,
      /\b(approve|approval|verification) (of )?(my )?(property|listing)\b/,
      /\bproperty not (visible|appearing|live|showing)\b/,
    ],
    answer: {
      en: "Your listings live under My Properties. Approved and Pending are separate tabs, so you can see exactly where each one sits.\n\nA listing stays Pending until our team has checked it. The usual reasons one sits there longer than expected are incomplete photos, missing or unclear ownership documents, or pricing and room details that have not been filled in yet. Open the listing and look for anything flagged.\n\nIf everything is complete and it has not moved, tell me the property name and I will pass it to the team for review.",
      sw: "Orodha zako zipo chini ya Majengo Yangu. Zilizokubaliwa na Zinazosubiri ni sehemu tofauti, hivyo unaona kila moja ilipo.\n\nOrodha inabaki Inasubiri mpaka timu yetu iikague. Sababu za kawaida za kukaa muda mrefu ni picha zisizokamilika, hati za umiliki zinazokosekana au zisizo wazi, au bei na taarifa za vyumba ambazo hazijajazwa. Fungua orodha na uangalie kama kuna kilichoonyeshwa.\n\nKama kila kitu kimekamilika na bado haijasonga, niambie jina la jengo nitapeleka kwa timu ikaguliwe.",
    },
    links: [
      { label: "Pending properties", href: "/owner/properties/pending" },
      { label: "Approved properties", href: "/owner/properties/approved" },
    ],
    verify: "Confirm the current review turnaround before Twiga quotes one to owners.",
  },
  {
    id: "owner-add-property",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(add|create|register) (a |another |new )?(property|listing|hotel|lodge)\b/,
      /\bhow do i (add|list) (my |a )?(second|another|new)\b/,
    ],
    answer: {
      en: "Add a property from My Properties, then Add New.\n\nYou will need photos, the location, a description, the amenities, your room or unit types with their pricing, and your cancellation policy. Ownership documents are checked as part of verification.\n\nYou can run several properties from one account. Room availability across them is managed under Room Availability.",
      sw: "Ongeza jengo kutoka Majengo Yangu, kisha Ongeza Jipya.\n\nUtahitaji picha, mahali lilipo, maelezo, huduma zilizopo, aina za vyumba na bei zake, na masharti yako ya kughairi. Hati za umiliki zinakaguliwa kama sehemu ya uhakiki.\n\nUnaweza kuendesha majengo kadhaa kwa akaunti moja. Upatikanaji wa vyumba katika yote unasimamiwa chini ya Upatikanaji wa Vyumba.",
    },
    links: [
      { label: "Add a property", href: "/owner/properties/add" },
      { label: "Room availability", href: "/owner/properties/availability" },
    ],
  },

  // ─── Bookings ────────────────────────────────────────────────────────────
  {
    id: "owner-bookings-checkin",
    audience: "owner",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(check.?in|check.?out) (a )?guest\b/,
      /\b(validate|verify) (a )?booking\b/,
      /\bguest (has )?(arrived|is here|checking in)\b/,
      /\bhow do i (check|mark) (them |the guest )?(in|out)\b/,
    ],
    answer: {
      en: "Bookings are grouped by where the guest is in their stay:\n\nCheck-in, validate an arriving guest against their booking\nChecked-In, everyone currently staying\nCheck-out, the stays due out\nChecked-Out, completed stays\n\nTo check someone in, open Check-in and validate their booking reference. The counts in the sidebar show how many are currently in house and how many are due to leave, so the day's work is visible without going looking for it.",
      sw: "Uhifadhi umepangwa kulingana na mgeni alipo kwenye muda wake:\n\nKuingia, thibitisha mgeni anayewasili dhidi ya uhifadhi wake\nWaliopo, wote wanaokaa sasa\nKutoka, wanaotakiwa kuondoka\nWalioondoka, waliomaliza\n\nKumuingiza mtu, fungua Kuingia na uthibitishe namba ya uhifadhi wake. Namba kwenye kando zinaonyesha wangapi wapo ndani na wangapi wanatakiwa kuondoka, hivyo kazi ya siku inaonekana bila kuitafuta.",
    },
    links: [
      { label: "Check-in", href: "/owner/bookings/validate" },
      { label: "Due to check out", href: "/owner/bookings/check-out" },
    ],
  },

  // ─── Money ───────────────────────────────────────────────────────────────
  {
    id: "owner-payouts",
    audience: "owner",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(when|how) (do|will) i get paid\b/,
      /\b(my )?(payout|payouts|disbursement|settlement)\b/,
      /\b(payment|money) (has )?not (come|arrived|been received|reached)\b/,
      /\bwhere is my money\b/,
      /\bpayout (status|pending|delayed)\b/,
    ],
    answer: {
      en: "Your earnings are under My Revenue, split by where each one has reached:\n\nRequested, you have raised it and it is awaiting processing\nPaid Invoices, settled\nRejected, sent back, open it to see why\n\nA payout moves through approval and batching before the money is released, so Requested is a normal state to sit in for a short while rather than a sign something is wrong.\n\nIf something has been in Requested far longer than usual, or was rejected and the reason is not clear, tell me and I will pass it to finance.",
      sw: "Mapato yako yapo chini ya Mapato Yangu, yamegawanywa kulingana na kila moja yalipofika:\n\nYameombwa, umeyaomba na yanasubiri kushughulikiwa\nAnkara Zilizolipwa, yamekamilika\nYamekataliwa, yamerudishwa, fungua uone sababu\n\nMalipo hupitia uidhinishaji na kuwekwa kwenye kundi kabla pesa hazijatolewa, hivyo Yameombwa ni hali ya kawaida kukaa kwa muda mfupi si dalili kwamba kuna tatizo.\n\nKama kitu kimekaa kwenye Yameombwa muda mrefu kuliko kawaida, au kimekataliwa na sababu haiko wazi, niambie nitapeleka kwa fedha.",
    },
    links: [
      { label: "Requested", href: "/owner/revenue/requested" },
      { label: "Paid invoices", href: "/owner/revenue/paid" },
      { label: "Rejected", href: "/owner/revenue/rejected" },
    ],
    verify: "Confirm the payout cadence and the normal time in Requested before Twiga quotes either.",
  },
  {
    id: "owner-invoices",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(raise|create|issue|send) (an )?invoice\b/,
      /\b(my )?invoices?\b/,
      /\breceipts? (for|from) (a )?(booking|guest|stay)\b/,
    ],
    exclude: [/\bnrms billing\b/],
    answer: {
      en: "You can raise a new invoice from New Invoice. Settled revenue and its paid invoices sit under My Revenue, in Paid Invoices.\n\nEach invoice carries its own reference and status, so you can point a guest or a company at a specific document rather than describing it.",
      sw: "Unaweza kutengeneza ankara mpya kutoka Ankara Mpya. Mapato yaliyokamilika na ankara zake zilizolipwa yapo chini ya Mapato Yangu, kwenye Ankara Zilizolipwa.\n\nKila ankara ina namba yake na hali yake, hivyo unaweza kumuelekeza mgeni au kampuni kwenye hati maalum badala ya kuieleza.",
    },
    links: [
      { label: "New invoice", href: "/owner/invoices/new" },
      { label: "Paid invoices", href: "/owner/revenue/paid" },
    ],
    verify:
      "There is no index page at /owner/invoices or /owner/revenue/receipts, only [id] and new. If an invoice list page is added, link it here.",
  },
  {
    id: "owner-group-stay-claims",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bgroup stay (claim|claims|request)\b/,
      /\b(claim|bid on|respond to) (a )?group\b/,
      /\bavailable to claim\b/,
      /\bmy claims\b/,
    ],
    answer: {
      en: "Group stays reach you in three places:\n\nAvailable to Claim, open group requests you can bid on\nMy Claims, the ones you have gone for and where they stand\nAssigned to Me, the ones you won and now need to deliver\n\nWhen you claim, you are putting an offer in front of the organiser alongside other properties. Respond quickly and price it properly, because the organiser is comparing.",
      sw: "Makazi ya kikundi yanakufikia sehemu tatu:\n\nYanayoweza Kudaiwa, maombi ya vikundi yaliyo wazi unayoweza kuyaomba\nMadai Yangu, uliyoyaomba na yalipofikia\nNiliyopewa, uliyoshinda na sasa unatakiwa kuyatekeleza\n\nUnapodai, unaweka ofa mbele ya mwandaaji pamoja na majengo mengine. Jibu haraka na uweke bei sahihi, kwa sababu mwandaaji analinganisha.",
    },
    links: [
      { label: "Available to claim", href: "/owner/group-stays/claims" },
      { label: "My claims", href: "/owner/group-stays/claims/my-claims" },
    ],
  },

  // ─── NRMS: what it is ────────────────────────────────────────────────────
  {
    id: "nrms-what-is-it",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bwhat is nrms\b/,
      /\bnrms\b/,
      /\b(property management system|pms|front desk system)\b/,
      /\bhotel (management )?(software|system)\b/,
    ],
    exclude: [
      /\bnrms (billing|invoice|charge|cost|price|pricing|fee)\b/,
      /\bnrms (is |was |has been )?(on trial|trial|frozen|blocked|suspended|locked)\b/,
      /\b(night audit|housekeeping|rooming list|fiscal|vfd|tra)\b/,
    ],
    answer: {
      en: "NRMS is the workspace for running a property day to day, not just taking bookings through NoLSAF. It is the NRMS Workspace item in your sidebar.\n\nIt covers:\nFront desk, arrivals, in house guests, and departures\nReservations, the room calendar, and group blocks\nRooms, rates, and hotel controls\nHousekeeping\nRestaurant, bar, tables, QR ordering, stock, and breakfast lists\nTravel agents and OTA channels\nShift and cash handover\nFinance, night audit, ledger, tax register, and reports\nStaff accounts with their own roles\n\nIt is designed for a property that is currently running on paper, spreadsheets, or nothing at all. Ask me about any one of those areas.",
      sw: "NRMS ni eneo la kazi la kuendesha jengo kila siku, si kupokea uhifadhi kupitia NoLSAF tu. Ni kipengele cha NRMS WORKSPACE kwenye kando yako.\n\nInahusu:\nMapokezi, wanaowasili, waliopo ndani, na wanaoondoka\nUhifadhi, kalenda ya vyumba, na vikundi\nVyumba, bei, na udhibiti wa hoteli\nUsafi\nMgahawa, baa, meza, kuagiza kwa QR, bidhaa, na orodha ya kifungua kinywa\nMawakala wa safari na njia za OTA\nZamu na makabidhiano ya fedha\nFedha, ukaguzi wa usiku, leja, daftari la kodi, na ripoti\nAkaunti za wafanyakazi na nafasi zao\n\nImetengenezwa kwa jengo linaloendeshwa kwa karatasi, majedwali, au bila mfumo kabisa. Niulize kuhusu eneo lolote kati ya hayo.",
    },
    links: [{ label: "NRMS workspace", href: "/owner/nrms" }],
  },
  {
    id: "nrms-activation-billing",
    audience: "owner",
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\bnrms (billing|invoice|charge|cost|price|pricing|fee|subscription)\b/,
      // Cost questions only. "what is nrms" belongs to the explainer entry.
      /\bhow much (does|is) nrms\b/,
      /\bwhat does nrms cost\b/,
      /\b(activate|activation|enroll|enrolment|enrollment|turn on) nrms\b/,
      /\bnrms (is |was |has been )?(on trial|trial|frozen|blocked|suspended|locked)\b/,
    ],
    answer: {
      en: "NRMS is activated per property from the NRMS workspace, and billing is per completed external room-night, meaning stays you bring in yourself rather than bookings that came through NoLSAF. Some properties start on a trial period.\n\nThe exact rate and trial length come from the usage policy shown to you on the activation screen, so check there for your own terms rather than taking a number from me.\n\nYour NRMS invoices are under NRMS billing. If the workspace is frozen or blocked, that is almost always an unpaid NRMS invoice, and it clears once billing is settled.",
      sw: "NRMS inawashwa kwa kila jengo kutoka eneo la kazi la NRMS, na malipo ni kwa kila usiku wa chumba wa nje uliokamilika, yaani wageni unaowaleta mwenyewe si uhifadhi uliokuja kupitia NoLSAF. Baadhi ya majengo yanaanza na kipindi cha majaribio.\n\nKiwango kamili na urefu wa majaribio vinatoka kwenye sera ya matumizi unayoonyeshwa kwenye skrini ya kuwasha, hivyo angalia hapo kwa masharti yako mwenyewe badala ya kuchukua namba kutoka kwangu.\n\nAnkara zako za NRMS zipo chini ya NRMS billing. Kama eneo la kazi limefungwa, mara nyingi ni ankara ya NRMS ambayo haijalipwa, na linafunguliwa malipo yakikamilika.",
    },
    links: [{ label: "NRMS billing", href: "/owner/nrms/billing" }],
  },

  // ─── NRMS: operations ────────────────────────────────────────────────────
  {
    id: "nrms-front-desk",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(front desk|reception)\b/,
      /\b(walk.?in|arrival|departure) (guest|booking)?\b/,
      /\bnrms (reservation|reservations)\b/,
      /\b(create|make|add) (a )?reservation\b/,
    ],
    answer: {
      en: "Front desk is the NRMS home screen. It shows today: who is arriving, who is in house, and who is leaving.\n\nReservations holds the full list and is where you create one directly, which is what you use for a walk in or a guest who called you rather than booking online. Room calendar gives you the same picture laid out by room and date, which is the faster way to see what is actually free.\n\nReception inquiries is where walk up and phone enquiries land so they do not get lost on a notepad.",
      sw: "Mapokezi ndiyo skrini ya kwanza ya NRMS. Inaonyesha ya leo: nani anawasili, nani yupo ndani, na nani anaondoka.\n\nUhifadhi una orodha kamili na ndipo unapotengeneza mpya moja kwa moja, ndicho unachotumia kwa mgeni aliyekuja bila taarifa au aliyekupigia simu badala ya kuhifadhi mtandaoni. Kalenda ya vyumba inakupa picha ile ile ikipangwa kwa chumba na tarehe, ndiyo njia ya haraka ya kuona kilicho wazi kweli.\n\nMaswali ya mapokezi ndipo maulizo ya waliokuja na ya simu yanapofika ili yasipotee kwenye karatasi.",
    },
    links: [
      { label: "Front desk", href: "/owner/nrms" },
      { label: "Reservations", href: "/owner/nrms/reservations" },
      { label: "Room calendar", href: "/owner/nrms/calendar" },
    ],
  },
  {
    id: "nrms-rooms-rates",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(set up|configure|add|edit|change) (my )?(rooms?|rates?|room type)\b/,
      /\bnrms (rooms?|rates?)\b/,
      /\b(hotel controls|rate plan|room type)\b/,
      /\b(change|update) (my )?(price|prices|pricing) (in|on) nrms\b/,
    ],
    answer: {
      en: "Rooms is where your room types and individual rooms are set up. Hotel controls is where the rest lives, and it is split into sections:\n\nRates, your pricing\nReadiness, whether the property is set up well enough to sell\nService desk\nGuest journey, the messaging guests receive\nPortfolio, across multiple properties\nGrowth\n\nGet Rooms right before anything else. The calendar, availability, housekeeping, and the rate work all read from it, so a room type that is wrong here is wrong everywhere.",
      sw: "Vyumba ndipo aina za vyumba vyako na vyumba vyenyewe vinapowekwa. Udhibiti wa hoteli ndipo mengine yalipo, na umegawanywa sehemu:\n\nBei, bei zako\nUtayari, kama jengo limewekwa vizuri kutosha kuuza\nDawati la huduma\nSafari ya mgeni, ujumbe wanaopokea wageni\nKundi la majengo, kwa majengo mengi\nUkuaji\n\nWeka Vyumba sawa kabla ya kitu kingine chochote. Kalenda, upatikanaji, usafi, na kazi ya bei vyote vinasoma kutoka hapo, hivyo aina ya chumba isiyo sahihi hapa ni isiyo sahihi kila mahali.",
    },
    links: [
      { label: "Rooms", href: "/owner/nrms/rooms" },
      { label: "Rates", href: "/owner/nrms/controls?section=rates" },
    ],
  },
  {
    id: "nrms-housekeeping",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [/\bhousekeep(ing|er)\b/, /\b(room )?(cleaning|clean the room|dirty room|room status)\b/],
    answer: {
      en: "Housekeeping tracks room status so the front desk is not guessing whether a room is ready to sell.\n\nIt works off departures and arrivals, so as guests check out the rooms appear for cleaning, and once marked clean they are available again. Give your housekeepers their own staff accounts with the housekeeper role so they update it themselves rather than reporting back to reception.",
      sw: "Usafi unafuatilia hali ya chumba ili mapokezi wasiwe wanakisia kama chumba kiko tayari kuuzwa.\n\nUnafanya kazi kutokana na wanaoondoka na wanaowasili, hivyo wageni wanapotoka vyumba vinaonekana kwa ajili ya kusafishwa, na vikishaandikwa visafi vinapatikana tena. Wape wasafishaji wako akaunti zao za ufanyakazi zenye nafasi ya usafi ili wajisasishe wenyewe badala ya kuripoti mapokezi.",
    },
    links: [{ label: "Housekeeping", href: "/owner/nrms/housekeeping" }],
  },
  {
    id: "nrms-food-beverage",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(restaurant|bar|outlet|menu|menus|kitchen)\b/,
      /\b(room service|food order|table|tabs?)\b/,
      /\bqr (code|order|menu)\b/,
      /\b(stock|inventory)\b/,
      /\bbreakfast list\b/,
    ],
    answer: {
      en: "Food and drink in NRMS:\n\nOutlets and menus, set up each restaurant, bar, or service point and what it sells\nLive room orders, orders charged to a guest's room, with the history alongside\nTables and tabs, for walk in covers who are not staying\nQR order points, printed codes a guest scans to order without waiting for a waiter\nStock, what you are holding\nBreakfast list, who is entitled to breakfast that morning\n\nCharges to a room land on the guest's bill, so it is settled at check out rather than chased separately.",
      sw: "Chakula na vinywaji kwenye NRMS:\n\nMaeneo ya huduma na menyu, weka kila mgahawa, baa, au kituo cha huduma na kinachouzwa\nMaagizo ya vyumba ya papo hapo, maagizo yanayowekwa kwenye chumba cha mgeni, pamoja na historia yake\nMeza na akaunti, kwa wateja wanaokuja bila kukaa\nVituo vya kuagiza vya QR, misimbo iliyochapishwa mgeni anaiskani kuagiza bila kusubiri mhudumu\nBidhaa, ulizonazo\nOrodha ya kifungua kinywa, nani anastahili kifungua kinywa asubuhi hiyo\n\nGharama za chumba zinaingia kwenye bili ya mgeni, hivyo zinalipwa wakati wa kutoka badala ya kufuatiliwa tofauti.",
    },
    links: [
      { label: "Outlets and menus", href: "/owner/nrms/outlets" },
      { label: "QR order points", href: "/owner/nrms/qr-codes" },
    ],
  },
  {
    id: "nrms-groups-rooming",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bgroup block\b/,
      /\brooming list\b/,
      /\bnrms group(s| reservation)\b/,
      /\b(block|hold) (rooms|a block)\b/,
    ],
    answer: {
      en: "Group blocks let you hold a set of rooms for one group without selling them individually, which is what you want for a conference, a wedding party, or a tour operator's allocation.\n\nYou create the block, hold the rooms, then attach the rooming list, the actual names going into each room, once the organiser sends it. That way the rooms are protected while the names are still being collected.",
      sw: "Vikundi vinakuwezesha kushikilia vyumba kadhaa kwa kikundi kimoja bila kuviuza kimoja kimoja, ndicho unachohitaji kwa kongamano, harusi, au mgawo wa mwendeshaji ziara.\n\nUnatengeneza kundi, unashikilia vyumba, kisha unaambatanisha orodha ya wakaaji, majina halisi yanayoingia kila chumba, mwandaaji akishaituma. Kwa njia hiyo vyumba vinalindwa wakati majina bado yanakusanywa.",
    },
    links: [{ label: "Group reservations", href: "/owner/nrms/groups" }],
  },
  {
    id: "nrms-travel-agents",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\btravel agent\b/,
      /\b(agent|agency) (partnership|request|booking)\b/,
      /\bpartnership request\b/,
      /\bagent (rate|commission)\b/,
    ],
    answer: {
      en: "Travel agents are handled in three parts:\n\nAll travel agents, who you work with\nPartnership requests, agents asking to work with you, which you approve or decline\nBooking requests, actual bookings an approved agent is sending you, including the guest names\n\nRate proposals is where agreed agent rates are negotiated rather than settled over WhatsApp and then forgotten.",
      sw: "Mawakala wa safari wanashughulikiwa kwa sehemu tatu:\n\nMawakala wote, unaofanya nao kazi\nMaombi ya ushirikiano, mawakala wanaoomba kufanya kazi nawe, unayoyakubali au kuyakataa\nMaombi ya uhifadhi, uhifadhi halisi wakala aliyekubaliwa anakutumia, pamoja na majina ya wageni\n\nMapendekezo ya bei ndipo bei zilizokubaliwa za mawakala zinapojadiliwa badala ya kuamuliwa kwa WhatsApp kisha kusahaulika.",
    },
    links: [
      { label: "Travel agents", href: "/owner/nrms/agents" },
      { label: "Partnership requests", href: "/owner/nrms/agents/partnerships" },
    ],
  },
  {
    id: "nrms-ota-channels",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(ota|channel manager|booking\.?com|expedia|airbnb)\b/,
      /\b(connect|sync|link) (my )?(channel|calendar|rooms)\b/,
      /\bdouble book(ing|ed)?\b/,
      /\bsales channel\b/,
    ],
    answer: {
      en: "OTA channels connect NRMS to Expedia Group, Booking.com, and Airbnb, so availability and reservations move between them and you are not keeping three calendars in your head. That is what stops the double bookings.\n\nSales channels is the wider view of where your business is actually coming from, direct, agent, OTA, or NoLSAF.\n\nConnect one channel, confirm it is syncing correctly for a few days, then add the next. Connecting everything at once makes a mapping mistake very hard to find.",
      sw: "Njia za OTA zinaunganisha NRMS na Expedia Group, Booking.com, na Airbnb, ili upatikanaji na uhifadhi vihamie kati yao na usiwe unashika kalenda tatu kichwani. Ndicho kinachozuia uhifadhi maradufu.\n\nNjia za mauzo ni mtazamo mpana wa biashara yako inakotoka kweli, moja kwa moja, wakala, OTA, au NoLSAF.\n\nUnganisha njia moja, hakikisha inasawazisha vizuri kwa siku chache, kisha ongeza nyingine. Kuunganisha zote kwa mara moja kunafanya kosa la ulinganishaji kuwa gumu sana kulipata.",
    },
    links: [{ label: "OTA channels", href: "/owner/nrms/channels" }],
  },
  {
    id: "nrms-inquiries-rates",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(inquiry|inquiries|enquiry|enquiries)\b/,
      /\brate (proposal|request)\b/,
      /\bcorporate rate\b/,
      /\bquote (a|for) (company|client|group)\b/,
    ],
    answer: {
      en: "Inquiries is where enquiries land before they are bookings: someone calling, walking up, or asking for a quote. They stay on the list until converted or closed, so nothing quietly dies in a notebook.\n\nRate proposals is for negotiated pricing, corporate rates, agent rates, and long stay deals. Proposing it in NRMS means the agreed rate is recorded against the account and applies automatically, instead of depending on whoever is on the desk remembering it.",
      sw: "Maulizo ndipo maswali yanapofika kabla hayajawa uhifadhi: mtu anayepiga simu, anayekuja, au anayeomba bei. Yanabaki kwenye orodha mpaka yabadilishwe kuwa uhifadhi au yafungwe, hivyo hakuna linalokufa kimya kwenye daftari.\n\nMapendekezo ya bei ni kwa bei zilizojadiliwa, bei za makampuni, bei za mawakala, na mikataba ya kukaa muda mrefu. Kupendekeza kwenye NRMS maana yake bei iliyokubaliwa inarekodiwa kwenye akaunti na inatumika yenyewe, badala ya kutegemea yeyote aliye mapokezi kuikumbuka.",
    },
    links: [
      { label: "Inquiries", href: "/owner/nrms/inquiries" },
      { label: "Rate proposals", href: "/owner/nrms/sales-rates" },
    ],
  },

  // ─── NRMS: money and compliance ──────────────────────────────────────────
  {
    id: "nrms-night-audit",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\bnight audit\b/,
      /\bcashier variance\b/,
      /\b(accounting )?ledger\b/,
      /\btax register\b/,
      /\bnbs (statistics|report)\b/,
      /\bnrms (finance|expenses)\b/,
    ],
    answer: {
      en: "Finance and Night Audit covers the close of business:\n\nNight Audit, closing the day so the numbers are fixed rather than drifting\nCashier variance, what each cashier took against what they should have taken\nExpenses\nAccounting ledger\nTax register\nNBS statistics, the occupancy reporting\n\nNight audit and cashier variance are open to front desk as well as managers and owners. Expenses, ledger, tax, and NBS are restricted to managers and owners.\n\nRun the night audit daily. Skipping it and catching up later is how a variance becomes impossible to trace back to a shift.",
      sw: "Fedha na Ukaguzi wa Usiku unahusu kufunga biashara ya siku:\n\nUkaguzi wa Usiku, kufunga siku ili namba zibaki thabiti\nTofauti ya keshia, kila keshia alichopokea dhidi ya alichotakiwa kupokea\nMatumizi\nLeja ya hesabu\nDaftari la kodi\nTakwimu za NBS, ripoti ya ukaaji\n\nUkaguzi wa usiku na tofauti ya keshia vinapatikana kwa mapokezi pamoja na wasimamizi na wamiliki. Matumizi, leja, kodi, na NBS ni kwa wasimamizi na wamiliki pekee.\n\nFanya ukaguzi wa usiku kila siku. Kuruka na kufidia baadaye ndiyo namna tofauti inavyokuwa ngumu kuifuatilia hadi kwenye zamu.",
    },
    links: [{ label: "Finance and night audit", href: "/owner/nrms/finance" }],
  },
  {
    id: "nrms-fiscal-receipts",
    audience: "owner",
    // Above the generic receipts entry: a tax compliance question must never
    // fall through to "download it from your booking".
    priority: PRIORITY.TRANSACTIONAL,
    patterns: [
      /\b(fiscal|vfd) receipt\b/,
      /\btra\b/,
      /\b(efd|vfd)\b/,
      /\b(tax|vat) receipt\b/,
    ],
    answer: {
      en: "To be straight with you: TRA fiscal receipting is set up in NRMS but is not issuing live receipts yet. The connection to TRA's virtual fiscal device is still waiting on their own specification, so I will not tell you it is working when it is not.\n\nUntil it goes live, keep issuing fiscal receipts the way you do now. Your NRMS tax register still records what is owed, so the numbers are ready when the connection opens.\n\nI will not guess at a date. Ask support if you need to plan around it.",
      sw: "Nikuambie ukweli: utoaji wa risiti za kodi za TRA umewekwa kwenye NRMS lakini bado hautoi risiti moja kwa moja. Muunganisho na kifaa cha kodi cha TRA bado unasubiri maelezo yao wenyewe, hivyo sitakuambia unafanya kazi wakati haufanyi.\n\nMpaka utakapoanza, endelea kutoa risiti za kodi kama unavyofanya sasa. Daftari lako la kodi la NRMS bado linarekodi kinachodaiwa, hivyo namba zitakuwa tayari muunganisho ukifunguliwa.\n\nSitakisia tarehe. Uliza msaada kama unahitaji kupanga kulingana na hilo.",
    },
    verify:
      "Revisit when the TRA VFD adapter ships. Until then this entry must keep saying it is not live.",
  },
  {
    id: "nrms-payments-merchant",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(nolsaf payments|merchant|merchant account)\b/,
      /\b(collect|take) (payment|money) (from|at) (the )?(property|front desk|guest)\b/,
      /\bnrms payments\b/,
    ],
    answer: {
      en: "NoLSAF Payments is how a property collects money directly, at the desk or from a guest paying for their own stay, rather than only receiving what comes through NoLSAF bookings.\n\nIt runs against a merchant, which is the legal entity taking the money. If you operate several properties under one company, they sit under the same merchant.\n\nSet this up before you start taking direct payments, not after, so what you collect reconciles cleanly in finance.",
      sw: "NoLSAF Payments ndiyo namna jengo linavyokusanya pesa moja kwa moja, kwenye dawati au kutoka kwa mgeni anayelipia ukaaji wake, badala ya kupokea tu kinachokuja kupitia uhifadhi wa NoLSAF.\n\nInafanya kazi chini ya mfanyabiashara, ambaye ni taasisi ya kisheria inayopokea pesa. Kama unaendesha majengo kadhaa chini ya kampuni moja, yanakuwa chini ya mfanyabiashara mmoja.\n\nWeka hii kabla ya kuanza kupokea malipo ya moja kwa moja, si baada, ili unachokusanya kilingane vizuri kwenye fedha.",
    },
    links: [{ label: "NoLSAF Payments", href: "/owner/nrms/payments" }],
    verify: "Per-property wallets were still undecided. Keep this entry vague on wallet structure until that lands.",
  },

  // ─── NRMS: people and reporting ──────────────────────────────────────────
  {
    id: "nrms-staff-access",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(staff|employee|team) (account|access|member|role|invite)\b/,
      /\badd (a )?(staff|receptionist|manager|waiter|housekeeper)\b/,
      /\b(give|grant) (someone|my staff) access\b/,
      /\bstaff (and )?roles?\b/,
    ],
    answer: {
      en: "Staff and roles is where you give your team their own accounts instead of sharing yours.\n\nRoles available: manager, front desk, housekeeper, restaurant, bar, and outlet supervisor. Each one only sees what that job needs, so a waiter is not looking at your ledger.\n\nTwo things worth knowing. A staff account is tied to the property, and it never grants owner access no matter the role. And you can set an end date for seasonal or contract staff, which flags the assignment as lapsed rather than cutting someone off mid shift.",
      sw: "Wafanyakazi na nafasi ndipo unapowapa timu yako akaunti zao badala ya kushiriki yako.\n\nNafasi zilizopo: msimamizi, mapokezi, usafi, mgahawa, baa, na msimamizi wa eneo la huduma. Kila mmoja anaona tu kinachohitajika kwa kazi yake, hivyo mhudumu haangalii leja yako.\n\nMambo mawili ya kujua. Akaunti ya mfanyakazi imefungwa kwenye jengo, na kamwe haitoi ufikiaji wa mmiliki bila kujali nafasi. Na unaweza kuweka tarehe ya mwisho kwa wafanyakazi wa msimu au mkataba, ambayo inaonyesha kazi yake imeisha badala ya kumkata mtu katikati ya zamu.",
    },
    links: [{ label: "Staff and roles", href: "/owner/nrms/staff" }],
  },
  {
    id: "nrms-shift-cash",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(shift|handover|hand over)\b/,
      /\b(cash) (up|drawer|float|count|handover)\b/,
      /\bclose (my |the )?shift\b/,
    ],
    answer: {
      en: "Shift and cash is the handover between one person on the desk and the next. The outgoing shift closes with what they are handing over, and that becomes the opening position for the next.\n\nThis is what makes cashier variance in finance mean anything. Without a closed shift there is nothing to compare the takings against, and a shortfall cannot be traced to a person or a time.",
      sw: "Zamu na fedha ni makabidhiano kati ya mtu mmoja wa dawati na anayefuata. Zamu inayotoka inafungwa na kile wanachokabidhi, na hiyo inakuwa hali ya kuanzia ya inayofuata.\n\nHiki ndicho kinachofanya tofauti ya keshia kwenye fedha iwe na maana. Bila zamu iliyofungwa hakuna cha kulinganisha na mapato, na upungufu hauwezi kufuatiliwa hadi kwa mtu au wakati.",
    },
    links: [{ label: "Shift and cash", href: "/owner/nrms/shift" }],
  },
  {
    id: "owner-reports",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(report|reports|analytics|statistics|occupancy|adr|revpar)\b/,
      /\bhow (is|are) (my )?(business|property|performance) doing\b/,
      /\bperformance\b/,
    ],
    answer: {
      en: "Two levels of reporting.\n\nAcross NoLSAF: Reports under My Revenue, covering overview, bookings, customers, occupancy, revenue, and stays.\n\nInside NRMS: Performance for how the property is trading, Revenue and analytics for the money, and Reports for the documents you can pull and print.\n\nTell me what you are trying to work out, whether that is occupancy trend, where your bookings come from, or which rooms underperform, and I will point you at the right one.",
      sw: "Ngazi mbili za ripoti.\n\nKatika NoLSAF yote: Ripoti chini ya Mapato Yangu, zinazohusu muhtasari, uhifadhi, wateja, ukaaji, mapato, na ukaaji wa wageni.\n\nNdani ya NRMS: Utendaji kwa jinsi jengo linavyofanya biashara, Mapato na uchambuzi kwa pesa, na Ripoti kwa hati unazoweza kutoa na kuchapisha.\n\nNiambie unachotaka kujua, iwe mwenendo wa ukaaji, uhifadhi wako unakotoka, au vyumba gani havifanyi vizuri, nami nitakuelekeza kwenye sahihi.",
    },
    links: [
      { label: "NoLSAF reports", href: "/owner/reports/overview" },
      { label: "NRMS performance", href: "/owner/nrms/performance" },
    ],
  },
  {
    id: "owner-security",
    audience: "owner",
    priority: PRIORITY.SERVICE,
    patterns: [
      /\b(2fa|two.?factor|passkey|passkeys)\b/,
      /\b(login history|active sessions?|sign.?in history)\b/,
      /\bsecure my account\b/,
      /\bowner settings\b/,
    ],
    answer: {
      en: "Your security settings are under Settings:\n\nPassword\n2FA, two factor authentication\nPasskeys, sign in without a password\nSessions, what is currently signed in, and you can end any of them\nLogin history\n\nIf you have staff, give them their own accounts under Staff and roles rather than sharing yours. Sharing an owner login gives whoever has it your finance and payout access, and login history cannot tell you which of them it was.",
      sw: "Mipangilio yako ya usalama ipo chini ya Mipangilio:\n\nNenosiri\n2FA, uthibitisho wa hatua mbili\nPasskeys, kuingia bila nenosiri\nVipindi, vilivyoingia sasa, na unaweza kumaliza chochote\nHistoria ya kuingia\n\nKama una wafanyakazi, wape akaunti zao chini ya Wafanyakazi na nafasi badala ya kushiriki yako. Kushiriki akaunti ya mmiliki kunampa aliyenayo ufikiaji wako wa fedha na malipo, na historia ya kuingia haiwezi kukuambia alikuwa nani kati yao.",
    },
    links: [
      { label: "Security settings", href: "/owner/settings" },
      { label: "Passkeys", href: "/owner/settings/passkeys" },
    ],
  },
  {
    id: "owner-support",
    audience: "owner",
    priority: PRIORITY.GENERAL,
    patterns: [
      /\b(owner|nrms) (support|help|guide|docs|documentation)\b/,
      /\bwhere (is|are) the (guide|docs|manual)\b/,
    ],
    answer: {
      en: "There is written documentation under Docs, and NRMS has its own help section inside the workspace.\n\nFor anything those do not answer, Support is in your sidebar, or tell me here and I will pass it to the team with the context of what you have already tried.",
      sw: "Kuna maelezo yaliyoandikwa chini ya Nyaraka, na NRMS ina sehemu yake ya msaada ndani ya eneo la kazi.\n\nKwa lolote ambalo hayo hayajibu, Msaada upo kwenye kando yako, au niambie hapa nami nitapeleka kwa timu pamoja na maelezo ya ulichokwisha jaribu.",
    },
    links: [
      { label: "Owner docs", href: "/owner/docs" },
      { label: "NRMS help", href: "/owner/nrms/help" },
      { label: "Support", href: "/owner/support" },
    ],
  },
];
