"use client";

import { TermsSection } from "./Terms";

export const PRIVACY_LAST_UPDATED = "10 October 2026";

export const PRIVACY_SECTIONS: TermsSection[] = [
  {
    title: "Overview",
    content: (
      <div className="space-y-4">
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6 rounded">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary</h3>
          <p className="text-sm text-gray-700 leading-relaxed">
            NoLSAF is committed to protecting your privacy and personal information. This Privacy Policy explains how we collect, use, store, and protect your data when you use our platform to book accommodations, request transport, make payments, register or onboard, arrange group stays, book tour packages, use trip planning tools, set optional Karibu NoLSAF welcome preferences, or provide services as an owner, driver, or tour operator. We collect information necessary to provide these services, including account details, booking information, payment data, location and route information, group passenger details, optional welcome preferences and feedback, tour permit information, and sensitive travel compliance documents where required. We use this data to facilitate bookings, process payments, verify identities, arrange services, process permits, improve our services, and communicate with you. We protect access to your account data, including by verifying self-service data downloads through a code sent to a verified contact. We share data with service providers, verified service partners, and authorities only as described below or as required by law. You have rights to access, update, or request deletion of your personal information, subject to legal and operational retention requirements. NoLSAF is operated by NoLS Africa Company Limited, a data controller registered with the Personal Data Protection Commission under the Personal Data Protection Act, No. 11 of 2022 (Registration No. 0-000-011-671).
          </p>
        </div>

        <p>
          <strong>1.0 Introduction</strong><br />
          NoLSAF ("we," "us," or "our") respects your privacy and is committed to protecting your personal information. This Privacy Policy describes how we collect, use, disclose, store, and protect your personal data when you access or use our platform, website, mobile applications, and related services (collectively, the "Services"). This policy applies to all Users, property Owners, Drivers, and visitors to our platform.
        </p>

        <p>
          <strong>1.1 Scope</strong><br />
          This Privacy Policy applies to all personal information collected by NoLSAF through our Services, including but not limited to information provided during account registration, onboarding, property listings, accommodation bookings, transport requests, group stays, tour package bookings, permit processing, trip estimates, payment processing, Karibu NoLSAF preferences and welcomes, account data copy requests, customer support interactions, and use of our website and mobile applications.
        </p>

        <p>
          <strong>1.2 Consent</strong><br />
          By accessing or using our Services, you acknowledge that you have read, understood, and agree to be bound by this Privacy Policy. If you do not agree with any part of this policy, please do not use our Services. Your continued use of our Services after any changes to this policy constitutes your acceptance of those changes.
        </p>

        <p>
          <strong>1.3 Data Controller and Registration</strong><br />
          1.3.1 The Services are operated by NoLS Africa Company Limited, a company incorporated in the United Republic of Tanzania, of P.O. Box 16106, Dar es Salaam (&quot;NoLS Africa&quot;). For the purposes of the Personal Data Protection Act, No. 11 of 2022 (the &quot;Act&quot;) and its regulations, NoLS Africa is the data controller responsible for the personal data processed through the Services, save where this Privacy Policy states that another party acts as an independent controller.<br />
          1.3.2 NoLS Africa is registered as a data controller with the Personal Data Protection Commission (the &quot;Commission&quot;) in accordance with the Act. Registration Number: 0-000-011-671. Date of registration: 31 August 2026. Registration valid until: 31 August 2031.<br />
          1.3.3 NoLS Africa processes personal data in accordance with the Act, the regulations made under it and the conditions of its registration, including the principles that personal data is processed lawfully, fairly and transparently, collected for specified and lawful purposes, limited to what is necessary, kept accurate, retained no longer than necessary and protected by appropriate security safeguards.<br />
          1.3.4 Registration with the Commission confirms that NoLS Africa is recorded as a data controller. It is not a certification or endorsement by the Commission of any particular service or practice described in this Privacy Policy.<br />
          1.3.5 Where a property Owner, Driver, tour operator or other service partner receives your personal data to deliver a service you have booked, that partner may also act as a data controller in its own right and is responsible for its own compliance with the Act.
        </p>

        <p>
          <strong>2.0 Information We Collect</strong><br />
          We collect various types of information to provide, maintain, and improve our Services. The information we collect depends on how you interact with our platform and the role you assume (User, Owner, or Driver).
        </p>

        <p>
          <strong>2.1 Information You Provide Directly</strong><br />
          We collect information that you voluntarily provide when using our Services, including;<br />
          <strong>2.1.1 Account Registration Information</strong><br />
          When you create an account, we collect;<br />
          a. Full name<br />
          b. Email address<br />
          c. Phone number (including country code)<br />
          d. Password (stored as a one-way hash, not in readable form)<br />
          e. Role selection (User/Traveller, Owner, or Driver)<br />
          f. Profile photo or avatar (optional)<br />
          g. Referral code or inviter details where you register through an invite link<br />
          h. Preferred currency, language, notification preferences, and security settings where you provide them<br />
          <em>Example: When you register as a property owner, we collect your name, email, and phone number to create your account and enable you to list properties and manage bookings.</em>
        </p>

        <p>
          <strong>2.1.2 Property Owner Information</strong><br />
          If you are a property Owner, we collect additional information including;<br />
          a. Property details (address, description, amenities, photos)<br />
          b. Property ownership documents (title deeds, rental agreements, business licenses)<br />
          c. Operating permits and licenses for short-term rentals<br />
          d. Tax compliance documentation<br />
          e. Bank account details for payouts (account name, bank name, account number, branch)<br />
          f. Mobile money provider and number for payouts (M-Pesa, Mixx by Yas, Airtel Money, etc.)<br />
          g. Payout preferences<br />
          <em>Example: To process your earnings from bookings, we need your bank account or mobile money details. This information is encrypted and only used for payment processing.</em>
        </p>

        <p>
          <strong>2.1.3 Driver Information</strong><br />
          If you are a Driver, we collect additional information including;<br />
          a. Vehicle information (make, model, license plate number)<br />
          b. Driver's license number and expiration date<br />
          c. Vehicle registration documents<br />
          d. Insurance information<br />
          e. Bank account or mobile money details for earnings<br />
          f. Location data (when providing transportation services)<br />
          <em>Example: We collect your vehicle and license information to verify your eligibility to provide transportation services and ensure passenger safety.</em>
        </p>

        <p>
          <strong>2.1.4 Accommodation Booking Information</strong><br />
          When you make an accommodation booking, we collect;<br />
          a. Check-in and check-out dates<br />
          b. Guest name, phone number, and email address where provided<br />
          c. Nationality, sex, age group, adults, children, pets, and room quantity where required for the booking flow<br />
          d. Selected property, room type, room code or unit, special requests, and stay preferences<br />
          e. Optional transport add-ons, including pickup address, pickup coordinates, arrival type, arrival number, transport company, arrival time, vehicle type, and pickup location<br />
          f. Payment information and invoice information processed through third-party payment processors<br />
          <em>Example: We store your booking dates, guest contact details, selected room, and transport add-on details to reserve the property, create the invoice, send confirmations, and coordinate arrival.</em>
        </p>

        <p>
          <strong>2.1.5 Transport Booking Information</strong><br />
          When you request transport, we collect;<br />
          a. Passenger name, phone number, email address, and linked account details where available<br />
          b. Pickup and drop-off addresses, GPS coordinates, route distance and duration estimates<br />
          c. Scheduled date, pickup time, drop-off time, vehicle type, number of passengers, notes, and preferred driver language<br />
          d. Arrival details such as flight, bus, train, ferry, or other arrival type, arrival number, transport company, arrival time, and pickup location<br />
          e. Trip code, payment status, assigned driver, driver/passenger ratings, reviews, and transport messages<br />
          <em>Example: We use your pickup coordinates and destination address to calculate the fare, match a driver, and help the driver reach you.</em>
        </p>

        <p>
          <strong>2.1.6 Group Stay Information</strong><br />
          When you request a group stay, we collect;<br />
          a. Group type, headcount, male/female/other count, room size, rooms needed, private room needs, and accommodation type<br />
          b. Origin and destination country, region, district, ward, exact location, and flexible or fixed dates<br />
          c. Arrangement preferences such as pickup, transport, meals, guide/staff, equipment, pickup location, pickup time, and arrangement notes<br />
          d. Passenger roster details, including first name, last name, phone number, age, gender, nationality, and sequence number where provided<br />
          e. Messages, owner offers, selected property, deposit payment information, and cancellation or status notes<br />
          <em>Example: For a school, team, event, family, workers, or safari group stay, we may collect a passenger roster and room breakdown so verified owners can prepare suitable accommodation and NoLSAF can coordinate the booking.</em>
        </p>

        <p>
          <strong>2.1.7 Tour Package and Permit Information</strong><br />
          When you book a tour package or request operator-supported travel arrangements, we collect;<br />
          a. Tour operator, package, destination, category, travel dates, traveler count, guest name, email, phone number, nationality, and booking notes<br />
          b. Package and operator snapshots so your purchased package can be honored even if the operator later edits their profile<br />
          c. Passenger or traveler roster details needed for tour operations, permit processing, conservation area entry, park entry, accommodation, transport, and emergency support<br />
          d. Passport details or passport copies, national ID details where applicable, visa or permit information, travel insurance details, and emergency contact details where required for the booked package<br />
          e. Yellow fever certificate, vaccination proof, medical, dietary, mobility, accessibility, or other health-related information only where legally or operationally required for the tour, permit, destination, operator, carrier, park, or authority<br />
          f. Payment access tokens, payment references, payer phone number, bank or mobile money details required to initiate payment, card checkout references, and payment status<br />
          <em>Example: Some safari, park, conservation, border, island, or multi-day packages require passport information, permit details, yellow fever proof, or passenger rosters. We collect these only when needed to deliver the booked tour or satisfy legal, authority, operator, safety, or permit requirements.</em>
        </p>

        <p>
          <strong>2.1.8 Trip Planning and Cost Estimate Information</strong><br />
          When you use trip planning or cost estimate tools, we may collect nationality or country code, destinations, travel dates, number of adults and children, transport preference, requested activities, accommodation tier, estimated cost breakdown, session identifier, anonymized IP address, and linked user ID where you are logged in.<br />
          <em>Example: We use your selected destinations, traveler count, nationality, activities, and transport preference to calculate park fees, visa-related estimates, transport estimates, and accommodation ranges.</em>
        </p>

        <p>
          <strong>2.1.9 Plan Request Information</strong><br />
          If a planning request service is available and you submit a request, we may collect your role, trip type, destinations, dates, group size, budget, notes, name, email, phone number, transport needs, pickup and drop-off locations, vehicle requirements, and role-specific event, school, university, community, or tourist requirements.<br />
          <em>Example: For a school or event planning request, we may collect age range, chaperone count, learning objectives, venue preferences, accessibility needs, and special support requirements so our team can prepare a suitable proposal.</em>
        </p>

        <p>
          <strong>2.1.10 Communication Data</strong><br />
          We collect information from your communications with us, including;<br />
          a. Customer support inquiries and responses<br />
          b. Feedback and reviews you submit<br />
          c. Messages sent through our platform<br />
          d. Newsletter subscription preferences<br />
          <em>Example: If you contact our support team about a booking issue, we keep a record of that conversation to help resolve your concern and improve our services.</em>
        </p>

        <p>
          <strong>2.1.11 Karibu NoLSAF Preferences and Welcome Records</strong><br />
          If you choose to set Karibu NoLSAF preferences, we collect the drink categories you enjoy, dietary needs or allergies you select, an optional dietary note, whether you want us to celebrate special days, and whether you want those preferences shared with the property during your stay. If you opt in to birthday recognition, we ask for your own birthday day and month only; we do not ask for the year in this feature. We also keep a record of welcomes actually issued for your linked bookings, their preparation and service status, and any delivery confirmation, rating, or note you submit after service. These choices are optional and start off. A saved preference or milestone does not guarantee a gift.<br />
          <em>Example: If you tell us you have a nut allergy, our team can take that into account when selecting a welcome drink. If you turn on property sharing, staff at the property where you are checked in can also see a short note about the drinks and dietary needs you chose to share.</em>
        </p>

        <p>
          <strong>2.1.12 Account Data Copy Requests</strong><br />
          When you request a copy of your account data, we ask which country you live in and let you optionally tell us why you want the copy. We record the requested format, verification method, request and download events, and security details needed to protect the process. The code is sent to an email address or phone number already verified on your account. The downloaded copy is delivered to your device; choosing a PDF uses your browser's print or save-as-PDF function.
        </p>

        <p>
          <strong>2.2 Information Collected Automatically</strong><br />
          When you use our Services, we automatically collect certain information about your device and usage patterns;<br />
          <strong>2.2.1 Device Information</strong><br />
          We collect information about the device you use to access our Services, including;<br />
          a. Device type (mobile, tablet, computer)<br />
          b. Operating system and version<br />
          c. Browser type and version<br />
          d. IP address<br />
          e. Unique device identifiers, app storage identifiers, session identifiers, login history, active session metadata, and security audit data<br />
          <strong>2.2.2 Usage Information</strong><br />
          We collect information about how you interact with our Services, including;<br />
          a. Pages visited and time spent on pages<br />
          b. Search queries and filters used<br />
          c. Features accessed<br />
          d. Click patterns and navigation paths<br />
          e. Date and time of access<br />
          <strong>2.2.3 Location Information</strong><br />
          With your permission, we may collect location data, including;<br />
          a. GPS coordinates (for Drivers providing transportation services)<br />
          b. Approximate location based on IP address<br />
          c. Location preferences for property searches<br />
          <em>Example: If you're a driver using our app, we collect your real-time location to match you with nearby ride requests and help passengers track their rides.</em>
        </p>

        <p>
          <strong>2.3 Cookies and Similar Technologies</strong><br />
          We use cookies, local storage, and similar technologies to enhance your experience and collect information;<br />
          <strong>2.3.1 Essential Cookies</strong><br />
          These cookies are necessary for the platform to function, including;<br />
          a. Authentication tokens, including secure session cookies and mobile secure storage tokens<br />
          b. Session management, role routing, CSRF protection, and account security<br />
          c. User preferences (theme, language)<br />
          d. Shopping cart and booking information<br />
          <strong>2.3.2 Analytics Cookies</strong><br />
          We use analytics to understand how our Services are used and improve them;<br />
          a. Page views and user interactions<br />
          b. Performance metrics<br />
          c. Error tracking<br />
          <strong>2.3.3 Local Storage</strong><br />
          We use browser local storage to;<br />
          a. Remember your login status<br />
          b. Store user preferences (accepted policies, widget settings)<br />
          c. Cache data for faster loading<br />
          d. Store cookie consent choices, temporary form state, draft data, and mobile app authentication tokens where applicable<br />
          <em>Example: We store your authentication token in a secure cookie so you don't have to log in every time you visit our platform. You can clear your cookies at any time through your browser settings.</em>
        </p>

        <p>
          <strong>2.4 Information from Third Parties</strong><br />
          We may receive information about you from third-party sources, including;<br />
          a. Payment processors (AzamPay, M-Pesa, Mixx by Yas, Airtel Money, HaloPesa, banks, card processors, etc.) - transaction status, payment method details, checkout references, webhooks, and payment event data<br />
          b. Social media platforms (if you choose to register or log in using social media)<br />
          c. Property verification services<br />
          d. Background check providers (for Drivers)<br />
          e. Government, permit, park, conservation, border, immigration, health, or regulatory authorities where needed for verification, tour permits, legal compliance, or travel operations<br />
          <em>Example: When you pay for a booking using M-Pesa, the payment processor sends us confirmation that your payment was successful, along with the transaction reference number.</em>
        </p>

        <p>
          <strong>3.0 How We Use Your Information</strong><br />
          We use the information we collect for various purposes to provide, maintain, and improve our Services;
        </p>

        <p>
          <strong>3.1 Service Provision</strong><br />
          We use your information to;<br />
          a. Create and manage your account<br />
          b. Process and facilitate bookings<br />
          c. Verify your identity and eligibility (for Owners, Drivers, Tour Operators, and where required for travellers)<br />
          d. Process payments, deposits, refunds, commissions, invoices, and payouts<br />
          e. Coordinate accommodation, transport, group stays, tour packages, permits, park entry, operator arrangements, and related services<br />
          f. Communicate with you about bookings, services, and account matters<br />
          g. Provide customer support<br />
          h. Send booking confirmations, receipts, vouchers, check-in codes, payment updates, and service updates<br />
          <em>Example: When you book a property, we use your email and phone number to send you booking confirmation, check-in instructions, and important updates about your stay.</em>
        </p>

        <p>
          <strong>3.2 Platform Operations</strong><br />
          We use your information to;<br />
          a. Verify property listings and ensure accuracy<br />
          b. Match Drivers with transportation requests<br />
          c. Match group stay requests with suitable verified property owners<br />
          d. Facilitate communication between Users, Owners, Drivers, Tour Operators, and NoLSAF support/admin teams<br />
          e. Process tour permits, passenger rosters, travel-document checks, and authority submissions where required for a booked service<br />
          f. Process reviews and ratings<br />
          g. Manage disputes and resolve issues<br />
          h. Enforce our Terms of Service and policies<br />
          <em>Example: We use property verification information to ensure that only legitimate, safe properties are listed on our platform, protecting both travelers and property owners.</em>
        </p>

        <p>
          <strong>3.3 Payment Processing</strong><br />
          We use payment information to;<br />
          a. Process booking payments from Users<br />
          b. Distribute payouts to Owners and Drivers<br />
          c. Process tour operator payouts, group stay deposits, platform commissions, and reconciliation records<br />
          d. Handle refunds and cancellations<br />
          e. Prevent fraud and unauthorized transactions<br />
          f. Comply with financial regulations<br />
          g. Record transaction references, checkout session IDs, payer phone numbers, bank codes, card checkout URLs, webhook payloads, and payment status updates needed for reconciliation and support<br />
          <em>Example: When you pay for a booking, we securely transmit your payment details to our payment processor (like AzamPay or Stripe) to complete the transaction. We don't store your full credit card number.</em>
        </p>

        <p>
          <strong>3.4 Communication and Marketing</strong><br />
          With your consent, we may use your information to;<br />
          a. Send newsletters and promotional materials<br />
          b. Notify you about special offers and new features<br />
          c. Request feedback and reviews<br />
          d. Send important service updates and policy changes<br />
          <em>Example: If you subscribe to our newsletter, we'll send you updates about new properties, travel tips, and special deals. You can unsubscribe at any time.</em>
        </p>

        <p>
          <strong>3.5 Safety and Security</strong><br />
          We use your information to;<br />
          a. Verify identities and prevent fraud<br />
          b. Detect and prevent unauthorized access<br />
          c. Investigate suspicious activities<br />
          d. Ensure compliance with laws, travel rules, health requirements, permit requirements, and financial regulations<br />
          e. Protect the safety of Users, Owners, Drivers, Tour Operators, passengers, and staff<br />
          f. Support emergency, accessibility, dietary, medical, or special assistance needs connected to a booked service<br />
          <em>Example: If we detect unusual activity on your account (like multiple failed login attempts), we may temporarily lock your account and notify you to prevent unauthorized access.</em>
        </p>

        <p>
          <strong>3.6 Analytics and Improvement</strong><br />
          We use aggregated and anonymized data to;<br />
          a. Analyze usage patterns and trends<br />
          b. Improve our Services and user experience<br />
          c. Develop new features and functionality<br />
          d. Conduct research and statistical analysis<br />
          e. Improve fare calculation, booking availability, group stay matching, tour package operations, and trip estimate accuracy<br />
          <em>Example: We analyze which property features are most searched for to help us improve our search functionality and help property owners understand what travelers are looking for.</em>
        </p>

        <p>
          <strong>3.7 Karibu NoLSAF and Your Choices</strong><br />
          We use your optional welcome preferences to help NoLSAF choose a suitable gesture for an eligible stay, avoid an obvious conflict with a selected dietary need, and coordinate service with a participating property. We use the welcome and feedback record to show your journey, check whether a gesture reached you, resolve problems, and assess the pilot. Birthday recognition is considered only when you opt in and provide your own day and month; it is not an automatic birthday reward. We do not use your Karibu dietary or birthday preferences to send marketing messages. Notification choices for booking updates, promotions, and referrals are managed separately in your account security settings.
        </p>

        <p>
          <strong>4.0 Information Sharing and Disclosure</strong><br />
          We do not sell your personal information. We may share your information only in the following circumstances;
        </p>

        <p>
          <strong>4.1 Service Providers</strong><br />
          We share information with trusted third-party service providers who assist us in operating our platform, including;<br />
          a. Payment processors (Stripe, AzamPay, M-Pesa, Mixx by Yas, Airtel Money, HaloPesa) - to process payments<br />
          b. Cloud hosting providers - to store and manage data<br />
          c. Email service providers - to send communications<br />
          d. SMS service providers - to send text messages and OTP codes<br />
          e. Analytics providers - to analyze usage patterns<br />
          f. Customer support platforms - to manage support requests<br />
          <em>Example: When you make a payment, we share necessary transaction details with AzamPay or your chosen payment provider to process the payment securely. These providers are contractually obligated to protect your information.</em>
        </p>

        <p>
          <strong>4.2 Business Partners</strong><br />
          We may share limited information with business partners, including;<br />
          a. Property Owners - booking details, guest information, stay dates, group stay information, selected offers, and communication history needed to host you<br />
          b. Drivers - ride request details, passenger information, pickup and drop-off locations, route information, notes, language preference, and timing information needed to provide transport<br />
          c. Tour Operators - tour booking details, passenger rosters, emergency contact details, passport or ID information, permit information, yellow fever or other required vaccination proof, dietary/medical/accessibility needs, and payment status needed to deliver the booked package<br />
          d. Verified service providers - accommodation providers, transport providers, guides, park/conservation operators, activity providers, support providers, and other partners needed to facilitate bookings and services<br />
          e. Permit, park, conservation, border, immigration, health, emergency, or regulatory authorities where disclosure is required or reasonably necessary for a booked tour, permit, safety, legal compliance, or dispute handling<br />
          <em>Example: When you book a property, we share your name, contact information, and booking details with the property owner so they can prepare for your arrival and communicate with you.</em>
        </p>

        <p>
          <strong>4.2.1 Sensitive Tour and Health-Related Data</strong><br />
          Passport information, yellow fever certificates, vaccination proof, medical, dietary, mobility, accessibility, and emergency information are treated as sensitive information. We use this information only for the relevant tour package, permit processing, legal or authority requirement, safety support, emergency response, or operational arrangement. We do not use this information for marketing.
        </p>

        <p>
          <strong>4.2.2 Karibu Welcome Preferences</strong><br />
          Authorized NoLSAF staff can use your saved Karibu preferences when arranging a welcome. Property staff can see a short note about your chosen drink and dietary preferences for an active stay only if you turn on &quot;Share with the property&quot;. Turning it off stops that preference note from appearing in the in-house staff view. We do not include your birthday in that property note. A property serving an issued welcome receives the order details needed to prepare and deliver it. Your welcome preferences are not sold to advertisers or used for their marketing.
        </p>

        <p>
          <strong>4.3 Legal Requirements</strong><br />
          We may disclose your information if required by law or in response to;<br />
          a. Court orders, subpoenas, or legal processes<br />
          b. Government requests or regulatory inquiries<br />
          c. Law enforcement investigations<br />
          d. Protection of rights, property, or safety<br />
          e. Prevention of fraud or illegal activities<br />
          <em>Example: If law enforcement requests information about a user as part of a criminal investigation, we may be legally required to provide that information.</em>
        </p>

        <p>
          <strong>4.4 Business Transfers</strong><br />
          In the event of a merger, acquisition, or sale of assets, your information may be transferred to the new entity. We will notify you of any such change and ensure the new entity continues to protect your information in accordance with this policy.
        </p>

        <p>
          <strong>4.5 With Your Consent</strong><br />
          We may share your information with third parties when you explicitly consent to such sharing, such as when you choose to connect your account with social media platforms or participate in promotional programs with partners.
        </p>

        <p>
          <strong>5.0 Data Security</strong><br />
          We implement comprehensive security measures to protect your personal information from unauthorized access, disclosure, alteration, or destruction;
        </p>

        <p>
          <strong>5.1 Technical Safeguards</strong><br />
          We employ a comprehensive multi-layered approach to technical security, implementing industry-standard measures to protect your personal information at every stage of its lifecycle. Our technical safeguards include the following components;
        </p>

        <p>
          <strong>5.1.1 Data Encryption</strong><br />
          We protect information in transit and limit access to stored information according to its purpose;<br />
          a. <strong>In transit:</strong> Our public web and API connections use Transport Layer Security (TLS) to protect account, booking, payment, and data-download traffic between your device and our services.<br />
          b. <strong>In storage:</strong> Passwords are stored as one-way hashes, and certain security secrets use application-level encryption. Contact and booking details must remain available in readable form to authorized staff and service systems that need them to deliver your services. Access controls and other safeguards protect those records; we do not claim that every personal-data field is separately encrypted.<br />
          <em>Example: An authorized support agent may need to read your verified email address to help with an account issue, but cannot retrieve your original password from its stored hash.</em>
        </p>

        <p>
          <strong>5.1.2 Password Security</strong><br />
          We implement robust password protection mechanisms to ensure your account credentials remain secure;<br />
          a. <strong>Hashing and Salting:</strong> Your password is never stored in plain text. Instead, we use cryptographic hashing algorithms combined with unique salt values for each password. This means that even if two users have the same password, they will have different hash values stored in our system. The hashing process is one-way, meaning your original password cannot be recovered from the stored hash.<br />
          b. <strong>Password Requirements:</strong> We enforce strong password policies requiring a combination of letters, numbers, and special characters to reduce the risk of password-based attacks.<br />
          c. <strong>Password Reset Security:</strong> When you request a password reset, we use secure, time-limited tokens sent to your verified email or phone number, ensuring only you can reset your password.<br />
          <em>Example: If your password is "MySecure123!", our system converts it into a complex hash like "a3f8b9c2d1e4f5..." using a unique salt. Even if someone gains access to our database and sees this hash, they cannot determine your original password. This is why we cannot tell you your password if you forget it - we can only help you reset it.</em>
        </p>

        <p>
          <strong>5.1.3 Access Controls and Authentication</strong><br />
          We implement strict access controls to ensure that only authorized individuals and systems can access your personal information;<br />
          a. <strong>Multi-Factor Authentication (MFA):</strong> For sensitive operations and account access, we support multi-factor authentication, requiring additional verification beyond just a password. This may include one-time passwords (OTP) sent via SMS or email, or authenticator app codes.<br />
          b. <strong>Role-Based Access Control (RBAC):</strong> Our system implements role-based access controls, ensuring that employees and systems can only access information necessary for their specific functions. For example, customer support staff can view booking information but cannot access payment card details.<br />
          c. <strong>Session Management:</strong> We use secure session tokens that expire after periods of inactivity. You can view and manage your active sessions through your account settings, allowing you to revoke access from any device.<br />
          d. <strong>API Security:</strong> Account and other protected API endpoints use authentication and relevant rate limits to reduce unauthorized access and abuse.<br />
          e. <strong>Account Data Downloads:</strong> A signed-in customer must enter a six-digit code sent to an already verified email address or phone number before a data copy is released. The code expires after 10 minutes. A successful check gives a download authorization valid for 10 minutes and tied to that account. Three wrong codes lock account data downloads until NoLSAF support verifies the account holder and an authorized administrator unlocks them. We record requests, verification, downloads, and lock events for security. We attempt to alert the account's verified email, or its verified phone when email is unavailable, after a download; delivery of that alert depends on the communication provider. Do not share the code or leave a downloaded file on a shared device.<br />
          <em>Example: When you log in, our system creates a secure session token that identifies you for subsequent requests. This token expires if you're inactive for a certain period, requiring you to log in again. You can see all your active sessions in your account settings and sign out from any device remotely.</em>
        </p>

        <p>
          <strong>5.1.4 Network and Infrastructure Security</strong><br />
          Our infrastructure is protected by multiple layers of network security;<br />
          a. <strong>Firewalls:</strong> We deploy advanced firewall systems that monitor and control incoming and outgoing network traffic based on predetermined security rules, blocking potentially malicious connections before they reach our servers.<br />
          b. <strong>Intrusion Detection and Prevention Systems (IDPS):</strong> Our systems continuously monitor for suspicious activities, unauthorized access attempts, and potential security threats. When threats are detected, automated systems can block malicious traffic and alert our security team.<br />
          c. <strong>Distributed Denial of Service (DDoS) Protection:</strong> We employ DDoS mitigation services to protect our platform from attacks that could disrupt service availability.<br />
          d. <strong>Secure Hosting:</strong> Our servers are hosted in secure data centers with physical security measures, redundant power supplies, and environmental controls.<br />
          <em>Example: If our system detects multiple failed login attempts from the same IP address, it automatically blocks further attempts from that source and may require additional verification. This protects your account from brute-force attacks where someone tries to guess your password.</em>
        </p>

        <p>
          <strong>5.1.5 Security Monitoring and Auditing</strong><br />
          We maintain continuous monitoring and regular assessments to identify and address security vulnerabilities;<br />
          a. <strong>Security Audits:</strong> We conduct regular internal and external security audits to identify potential vulnerabilities in our systems, applications, and processes. These audits are performed by qualified security professionals.<br />
          b. <strong>Vulnerability Assessments:</strong> We regularly scan our systems for known security vulnerabilities and apply patches and updates promptly to address any identified issues.<br />
          c. <strong>Security Logging:</strong> We maintain comprehensive logs of system activities, access attempts, and security events. These logs are regularly reviewed to detect anomalies and potential security incidents.<br />
          d. <strong>Penetration Testing:</strong> Periodically, we engage independent security experts to conduct penetration testing, attempting to identify security weaknesses that could be exploited by attackers.<br />
          <em>Example: Our security team regularly reviews access logs to identify unusual patterns, such as login attempts from unfamiliar locations or access to sensitive data outside normal business hours. If suspicious activity is detected, we investigate immediately and may temporarily restrict access while we verify the legitimacy of the activity.</em>
        </p>

        <p>
          <strong>5.1.6 Secure Development Practices</strong><br />
          Security is integrated into every stage of our software development lifecycle;<br />
          a. <strong>Secure Coding Standards:</strong> Our development team follows secure coding practices and guidelines to minimize the introduction of security vulnerabilities during software development.<br />
          b. <strong>Code Reviews:</strong> All code changes undergo security-focused code reviews before being deployed to production systems.<br />
          c. <strong>Dependency Management:</strong> We regularly update and patch third-party libraries and dependencies to address known security vulnerabilities.<br />
          d. <strong>Environment Separation:</strong> We maintain separate development, testing, and production environments, with production data never used in non-production environments.<br />
          <em>Example: Before any new feature is released, our security team reviews the code to ensure it doesn't introduce vulnerabilities. We also regularly update our software dependencies to patch any security issues discovered by the open-source community.</em>
        </p>

        <p>
          <strong>5.2 Organizational Safeguards</strong><br />
          We implement organizational measures to protect your data, including;<br />
          a. Limited access to personal information on a need-to-know basis<br />
          b. Employee training on data protection and privacy<br />
          c. Confidentiality agreements with employees and contractors<br />
          d. Regular review and update of security policies<br />
          <em>Example: Only authorized employees who need to process your booking or provide customer support have access to your personal information. All employees are trained on data protection practices.</em>
        </p>

        <p>
          <strong>5.3 Payment Security</strong><br />
          We take extra precautions to protect payment information. Our platform is designed for one-time payments, which means you will be required to enter your payment details for each transaction;<br />
          a. We do not store full credit card numbers or complete card details on our servers<br />
          b. Payment processing is handled by secure, certified payment processors<br />
          c. All payment transactions are encrypted during transmission<br />
          d. For local payment methods (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa, AzamPay), payment details are entered through secure popup windows provided by the payment provider<br />
          e. For bank, mobile money, and card flows, we may store transaction references, checkout session IDs, payer phone numbers, bank/payment provider identifiers, card checkout redirect references, webhook events, raw status codes, and payment status information necessary for booking confirmation, fraud prevention, support, refunds, reconciliation, and record-keeping<br />
          <em>Example: When you make a booking, you'll be prompted to enter your payment details through a secure popup window. For local mobile money payments, this popup is provided by your payment service (like M-Pesa or AzamPay). Your payment information is processed securely and we only store the transaction reference number to confirm your payment was successful. For each new booking, you'll enter your payment details again, ensuring maximum security.</em>
        </p>

        <p>
          <strong>5.4 Data Breach Response</strong><br />
          In the unlikely event of a data breach, we will;<br />
          a. Immediately investigate and contain the breach<br />
          b. Notify affected users as soon as possible<br />
          c. Report to relevant authorities as required by law<br />
          d. Take steps to prevent future breaches<br />
          e. Provide guidance on protective measures users can take<br />
        </p>

        <p>
          <strong>6.0 Data Retention</strong><br />
          We retain your personal information for as long as necessary to fulfill the purposes outlined in this policy, unless a longer retention period is required or permitted by law;
        </p>

        <p>
          <strong>6.1 Account Information</strong><br />
          We retain your account information for as long as your account is active. If you delete your account, we may retain certain information for a limited period to comply with legal obligations, resolve disputes, and enforce our agreements.
        </p>

        <p>
          <strong>6.2 Transaction Records</strong><br />
          We retain booking and payment records for a minimum of seven (7) years to comply with tax and financial regulations, resolve disputes, and provide customer support.
        </p>

        <p>
          <strong>6.3 Communication Records</strong><br />
          We retain customer support communications and messages for up to three (3) years to improve our services and resolve disputes.
        </p>

        <p>
          <strong>6.4 Sensitive Tour Documents and Health-Related Information</strong><br />
          Passport copies, permit documents, yellow fever certificates, vaccination proof, medical, dietary, mobility, accessibility, emergency contact, and similar sensitive tour information are retained only for as long as reasonably needed to process the booked service, satisfy authority or legal requirements, support safety and emergency obligations, resolve disputes, and maintain necessary operational records. Access to this information is limited to authorized personnel and service partners who need it for the relevant booking.
        </p>

        <p>
          <strong>6.5 Trip Estimates and Planning Requests</strong><br />
          Trip estimate inputs and planning request records may be retained to provide continuity, improve estimate accuracy, respond to customer requests, audit pricing logic, and support service delivery, unless deletion is required or appropriate under applicable law.
        </p>

        <p>
          <strong>6.6 Marketing Data</strong><br />
          If you unsubscribe from marketing communications, we will remove you from our marketing lists but may retain your email address on a suppression list to ensure we don't contact you again.
        </p>

        <p>
          <strong>6.7 Karibu Preferences, Welcomes, and Data Copy Records</strong><br />
          You can change or clear your optional Karibu preferences in your account. Clearing them removes the saved preference record, including a birthday day and month supplied for this feature; it does not erase booking records or a welcome already issued or served. We keep welcome and feedback records for service, payment, dispute, and accounting purposes for as long as those purposes or applicable obligations require. We keep data-copy request, download, and security audit records as needed to investigate access and meet record-keeping duties. A PDF or JSON copy you save on your own device is under your control.
        </p>

        <p>
          <strong>7.0 Your Rights and Choices</strong><br />
          You have various rights regarding your personal information, which you can exercise at any time;
        </p>

        <p>
          <strong>7.1 Access and Portability</strong><br />
          You have the right to;<br />
          a. Access your personal information<br />
          b. Request a copy of your data in a portable format<br />
          c. Review the information we hold about you<br />
          In Account &gt; Security &gt; Privacy and data, you can request a readable report to save as PDF or a machine-readable JSON copy. The self-service copy covers selected account-linked profile, stay, ride, tour, group stay, cancellation, review, saved stay, trip estimate, referral, notification choice, and Karibu preference and welcome records. Each record category is limited to its latest 1,000 entries. It does not contain passwords, complete payment card numbers, or every record that may exist outside this self-service view. For a broader access or portability request, or if you cannot use the download, contact us as described in section 7.7.
        </p>

        <p>
          <strong>7.2 Correction and Update</strong><br />
          You have the right to;<br />
          a. Correct inaccurate or incomplete information<br />
          b. Update your profile and account details<br />
          c. Modify your preferences and settings<br />
          <em>Example: If you change your phone number or email address, you can update it in your account settings at any time.</em>
        </p>

        <p>
          <strong>7.3 Deletion</strong><br />
          You have the right to request deletion of your personal information, subject to certain legal and operational requirements. We may retain some information as necessary for legal compliance, dispute resolution, or service provision.
        </p>

        <p>
          <strong>7.4 Opt-Out Rights</strong><br />
          You can opt out of;<br />
          a. Marketing communications (newsletters, promotional emails)<br />
          b. Non-essential cookies and tracking<br />
          c. Location tracking (for Drivers, this may affect service availability)<br />
          d. Optional Karibu birthday recognition and property sharing of your welcome preferences<br />
          <em>Example: You can change promotion messages in your notification settings, and turn off birthday recognition or property sharing in your Karibu preferences.</em>
        </p>

        <p>
          <strong>7.5 Account Deactivation</strong><br />
          You can deactivate or delete your account at any time through your account settings. Please note that some information may be retained as required by law or for legitimate business purposes.
        </p>

        <p>
          <strong>7.6 Data Portability</strong><br />
          You can request the self-service JSON copy described in section 7.1 to move account-linked data to another service. Before downloading, you select your country of residence and may optionally give a reason; then you confirm a code sent to a verified account contact. A request reason is not required to exercise your access or portability rights. You can contact us under section 7.7 if you need data outside the self-service copy.
        </p>

        <p>
          <strong>7.7 How to Exercise Your Rights</strong><br />
          You may exercise any of the rights described in this section, and any other right available to you under the Act, by writing to <a href="mailto:privacy@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">privacy@nolsaf.com</a> or to the postal address in section 12.0. To protect your information, we may ask you to verify your identity before acting on a request. We will respond within the period required by the Act. Where we are unable to comply with a request, in whole or in part, we will explain the reason, including any legal ground on which we rely.
        </p>

        <p>
          <strong>7.8 Right to Lodge a Complaint</strong><br />
          If you believe that we have processed your personal data in a manner that does not comply with the Act, we encourage you to contact us first so that we can try to resolve the matter. You also have the right to lodge a complaint with the Personal Data Protection Commission of the United Republic of Tanzania at any time. Exercising this right does not affect any other remedy available to you under the law.
        </p>

        <p>
          <strong>8.0 Children's Privacy</strong><br />
          Our Services are not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that we have collected information from a child under 18, we will take steps to delete that information promptly. If you believe we have collected information from a child, please contact us immediately at <a href="mailto:privacy@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">privacy@nolsaf.com</a>.
        </p>

        <p>
          <strong>9.0 International Data Transfers</strong><br />
          9.1 To operate the Services, personal data may be stored or processed outside the United Republic of Tanzania. In particular, our platform is hosted with cloud infrastructure providers whose data centres may be located in other countries, including within the European Union, and some of our service providers (for example, for email, SMS delivery, payments, maps and security monitoring) may process personal data in the countries where they operate.<br />
          9.2 Any transfer of personal data outside the United Republic of Tanzania is carried out in accordance with the requirements of the Act and its regulations on cross-border transfers. We transfer personal data only where the recipient country or the recipient provides an adequate level of protection, or where appropriate safeguards are in place, such as contractual obligations requiring the recipient to protect the data to a standard consistent with the Act, together with technical and organisational measures including encryption in transit and at rest and restricted access controls.<br />
          9.3 Where personal data is transferred to a property Owner, Driver, tour operator or other service partner located outside the United Republic of Tanzania, the transfer is made because it is necessary to perform the service you have booked, or with your consent.<br />
          9.4 You may contact us at the address in section 12.0 to request further information about the safeguards that apply to transfers of your personal data.
        </p>

        <p>
          <strong>10.0 Third-Party Links and Services</strong><br />
          Our Services may contain links to third-party websites, applications, or services that are not operated by us. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services you access through our platform.
        </p>

        <p>
          <strong>11.0 Changes to This Privacy Policy</strong><br />
          We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of any material changes by;<br />
          a. Posting the updated policy on our website with a new "Last updated" date<br />
          b. Sending an email notification to registered users<br />
          c. Displaying a prominent notice on our platform<br />
          Your continued use of our Services after such changes constitutes your acceptance of the updated policy.
        </p>

        <p>
          <strong>12.0 Contact Us</strong><br />
          If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us;<br />
          <strong>Email:</strong> <a href="mailto:privacy@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">privacy@nolsaf.com</a><br />
          <strong>Support Email:</strong> <a href="mailto:support@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">support@nolsaf.com</a><br />
          <strong>Data controller:</strong> NoLS Africa Company Limited (trading as NoLSAF)<br />
          <strong>Address:</strong> P.O. Box 16106, Dar es Salaam, United Republic of Tanzania<br />
          <strong>Data protection registration:</strong> Personal Data Protection Commission, Registration No. 0-000-011-671<br />
          We will respond to your inquiries within a reasonable timeframe and in accordance with applicable laws.
        </p>

        <p>
          <strong>13.0 Your Consent</strong><br />
          By using NoLSAF's Services, you acknowledge that you have read and understood this Privacy Policy and consent to the collection, use, and disclosure of your personal information as described herein. If you do not agree with any part of this policy, please discontinue use of our Services.
        </p>
      </div>
    ),
  },
];
