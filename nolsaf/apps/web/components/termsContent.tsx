"use client";

import Link from "@/components/PolicyLink";
import { TermsSection } from "./Terms";

export const TERMS_LAST_UPDATED = "8 October 2026";

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "Terms and Conditions",
    content: (
      <div className="space-y-4">
        <p>
          <strong>1.0 Introduction</strong><br />
          Welcome to NoLSAF! “We”, “us”, “our” specialize in offering curated, verified accommodations that empower our
          customers with budgetary freedom. By partnering with reliable local providers, we deliver integrated payment options
          and seamless single-click bookings for transport and logistics. This innovative approach enables both local and
          international travelers to effortlessly plan safe and affordable trips, enjoying the freedom to choose their unique
          travel experiences. Dive into a world of possibilities with NoLSAF, where we are dedicated to making your journey
          memorable and hassle-free. Before you begin, please take a moment to review our Terms and Conditions.
        </p>

        <p>
          <strong>1.1 Definitions</strong><br />
          1.1.1 Owner, the Owner refers to the individual or entity that possesses properties listed on NoLSAF. This entity is granted
          exclusive access to a personalized Dashboard, which serves as a powerful tool for monitoring, controlling, and managing
          their accommodations. Owners can update property details, manage bookings, respond to customer inquiries, and analyze
          performance metrics, all designed to enhance their operational efficiency. By participating in NoLSAF, Owners tap into a
          broader market, reaching diverse customers while maintaining control over their property listings.<br />
          1.1.2 Driver, the Driver is an individual who offers transportation services integrated into the NoLSAF experience. This role
          involves providing safe, reliable, and efficient transport options for Users seeking to navigate their travel destinations.
          Drivers play a crucial part in the overall travel experience by ensuring that Users are transported comfortably and
          punctually to their chosen locations. They are required to adhere to local transportation regulations and maintain high
          standards of customer service, significantly enhancing the travel experience for all Users.<br />
          1.1.3 User, a User is any individual who uses the NoLSAF platform to interact with our range of services. This includes
          searching for available properties that meet their travel needs, making bookings for accommodations, leaving reviews based
          on their experiences, and processing payments seamlessly through our secure system. Additionally, Users have the capability
          to request cancellations of their reservations when necessary. Our platform is designed to enhance the User experience,
          making travel planning straightforward and enjoyable, while providing essential support throughout their journey.<br />
          1.1.4 Listing, refers to the official representation of a property on the NoLSAF platform that includes comprehensive details,
          such as property descriptions, features, pricing, availability, high-resolution images, and user-generated reviews. Each
          Listing is intended to provide potential Users with all requisite information necessary for making informed decisions
          regarding their accommodation options.<br />
          1.1.5 Listed Property, refers to any property that has been formally registered and posted on the NoLSAF platform, available
          for booking by Users. The Listed Property must conform to the standards and requirements set forth by NoLSAF, ensuring its
          suitability for User engagement and adherence to applicable regulations. Owners of Listed Properties are responsible for
          maintaining the accuracy and currency of all information presented in their Listings.<br />
          1.1.6 Properties, the term Properties encompasses all accommodations available on the NoLSAF platform, including but not
          limited to residential units and related lodging facilities. Each Accommodation constitutes a distinct offering from an Owner
          and may include various amenities and features designed to meet the diverse needs of Users. Properties are subject to
          availability and compliance with relevant local laws and regulations governing their operation.<br />
          1.1.7 Group stay, refers to a reservation made for a number of guests traveling together and requiring multiple accommodations
          within the same property, typically characterized by the booking of multiple rooms or a larger unit capable of housing several
          individuals.
        </p>

        <p>
          <strong>1.2 Booking</strong><br />
          Booking refers to the formal process undertaken by Users when reserving accommodations or services through the NoLSAF
          platform. This procedure is meticulously designed to facilitate a seamless, efficient, and secure interaction between Users,
          Owners, and the NoLSAF platform. The Booking process encompasses several essential components:<br />
          1.2.1 Search and Discovery, users are afforded the capability to conduct thorough searches for properties that align with their
          specific travel requirements:<br />
          1.2.2 Search Filters, the platform enables Users to apply various filters, including, but not limited to, geographic location,
          price range, property type, availability dates, and amenities, thereby allowing Users to refine their options based on
          predefined criteria tailored to their preferences.<br />
          NB: a Booking shall be considered valid and binding once all requisite steps have been fulfilled and the User has been
          provided with the Booking Code. This framework ensures clarity and security for all parties involved in the transaction.
        </p>

        <p>
          <strong>1.3 Payment</strong><br />
          Payment refers to the financial transaction process that Users must complete to secure their reservations for accommodations or
          services through the NoLSAF platform. This process is integral to the overall Booking experience and is governed by specific
          terms and conditions outlined below;<br />
          1.3.1 Reservation Process, all bookings are contingent upon availability. Upon submission of a booking request, Users shall
          receive a confirmation email detailing the reservation specifics, including but not limited to;<br />
          a. Property name and address<br />
          b. Check-in and check-out dates<br />
          c. Total cost of reservation<br />
          d. Any applicable terms and conditions<br />
          1.3.2 Payment Terms, Payments must be executed through NoLSAF’s Secure Online Payment System. The following terms apply;<br />
          a. Payment Requirements; depending on the nature of the service selected, Users may be required to provide full payment upfront
          or submit a non-refundable deposit at the time of booking to secure their reservation. The specific payment terms shall be
          clearly articulated at the point of sale.<br />
          b. Authorized Payment Methods; Only those payment methods expressly accepted by NoLSAF shall be utilized for transactions.
          Payment options include;<br />
          i. Credit/Debit Cards; VISA cards and similar credit/debit cards.<br />
          ii. Online Payment Platforms; PayPal and Stripe.<br />
          iii. Local Payment Methods; Such as M-Pesa, AzamPay, Mixx by Yas, Airtel Money, and HaloPesa. Users should select the method that
          best accommodates their needs and ensure that they possess the requisite means to complete the transaction.<br />
          1.3.3 Payout<br />
          All payments made by Users shall be directed to NoLSAF accounts. Subsequently, NoLSAF shall disburse the appropriate amounts to
          the respective Owners and Drivers in accordance with established agreements and payout schedules (this is according to
          <Link href="/disbursement-policy" className="text-blue-600 hover:text-blue-800 underline">Disbursement Policy</Link>). This ensures that both the Owners and Drivers receive timely compensation for their services while
          maintaining financial transparency.<br />
          1.3.4 Cash Payment options, NoLSAF agrees to process only digital payments, except in instances where individuals submit a
          non-refundable deposit at the time of booking to secure their reservation. In such cases, the individual shall have the option
          to complete the remaining payment either through digital methods or by submitting cash upon check-in.<br />
          1.3.5 Booking Validity period, a booking shall remain valid for a period of 24 hours from the time of reservation if only a
          non-refundable deposit is paid. If the remaining balance is not settled within this timeframe, the booking may be subject to
          cancellation, and the property may become available for other Users.<br />
          1.3.6 No Room Assurance, users who opt for the non-refundable deposit payment method shall not be guaranteed the specific room
          selected if the remaining payment is not completed within the agreed framework. This lack of payment assurance may result in
          the reallocation of the User to an alternative available room that fits the original booking criteria.<br />
          1.3.7 Guaranteed Rate, the rates and availability of properties are subject to change. If the remaining payment is not made
          within the specified timeframes, Users may face an adjustment in pricing or availability upon rebooking, reflecting current
          rates and conditions.<br />
          1.3.8 Group Bookings exception, the reallocation of rooms shall not apply to reservations made for group stays. Users who book
          accommodations for a group shall have their booked rooms secured as specified in their reservation, provided that all payment
          terms are adhered to. If the remaining balance is not paid in accordance with the terms, the entire group booking may be
          subject to cancellation.<br />
          1.3.9 Change of Check-In Date, in order for a Group Stay reservation not to fall into complete cancellation, Users must notify
          the Owner within 24 hours of the scheduled check-in time to express their intention to change their check-in date. Such changes
          will be subject to approval and become valid under certain circumstances, including availability and any applicable terms
          outlined in the property’s policies.
        </p>

        <p>
          <strong>1.4 Pricing and Charges</strong><br />
          All charges associated with bookings will be quoted based on the original price. This practice ensures transparency and enables
          Users to have a clear understanding of the financial obligations involved in their reservations. The breakdown of costs will
          include the following key components;<br />
          1.4.1 Original Price Quotation, each property listing will specify the original price, serving as the baseline for all financial
          transactions. This price reflects the standard rate prior to any discounts, promotions, or additional fees, thereby providing
          Users with a consistent point of reference.<br />
          1.4.2 Detailed Cost Breakdown, users/traveller/customer will receive a comprehensive breakdown of all applicable charges at the
          time of booking. This breakdown will encompass, the original rate for the accommodation or service.<br />
          1.4.3 No Liability for External Payments, NoLSAF will not be liable for any payments made outside the platform, particularly
          after the User has arrived at their booked area. Any additional fees such as cleaning fees or service charges will be managed
          solely by the property Owner. Users should understand that NoLSAF solely facilitates the booking process and any payments
          related to additional services or fees occurring after the initial transaction fall under the Owner’s management.<br />
          1.4.4 Engagement in Booking Packages, the only packages that NoLSAF will engage with are those added during the booking process,
          particularly for end-to-end services, including transportation. Users may optionally include transport packages in their
          bookings, whether they require immediate scheduling or advance planning. Additionally, any inclusive services offered alongside
          the booking must be agreed upon at the time of reservation.<br />
          1.4.5 Communication of Discounts and Surcharges, any promotional discounts or time sensitive offers will be clearly communicated,
          allowing Users to take advantage of cost-saving opportunities while booking. Conversely, any surcharges incurred such as fees
          for additional services or late check-ins will also be communicated clearly to prevent unforeseen financial implications.
        </p>

        <p>
          <strong>1.5 Currency</strong><br />
          All prices displayed on the NoLSAF platform are quoted in the local currency unless expressly stated otherwise. This approach
          ensures clarity and consistency for Users when making reservations. The following components further elaborate on our currency
          policies:<br />
          1.5.1 Local Currency Quotation, prices for accommodations, services, and any associated fees will be presented in the local
          currency relevant to the property’s location. This practice helps Users avoid confusion related to currency conversions and
          allows for straightforward financial planning.<br />
          1.5.2 Exchange Rates, users shall be informed of the applicable exchange rates at the time of booking if they are transacting in
          a currency different from the local currency. NoLSAF will strive to provide the most accurate and competitive rates available;
          however, Users are encouraged to consult their financial institutions for the most current rates prior to completing
          transactions.<br />
          1.5.3 Transaction Fees, any potential transaction fees related to currency conversion or international payments may apply
          depending on the payment method utilized. Users will be made aware of these fees during the booking process, ensuring they can
          account for any additional costs that may arise from their payment selections.<br />
          1.5.4 Responsibility for Currency Conversion, Users are responsible for any fees associated with converting funds to the required
          local currency. This includes any bank charges or processing fees incurred as a result of using international credit/debit
          cards or mobile payment platforms.<br />
          1.5.5 Payment Processing Compliance, all currency transactions processed through the NoLSAF platform will comply with applicable
          financial regulations and standards of a certain region. Users can rest assured that their transactions will be handled
          securely, minimizing risk related to currency exchange.
        </p>

        <p>
          <strong>1.6 Cancellations and Refunds</strong><br />
          Cancellation terms vary based on the service booked, and Users are encouraged to review the specific <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>
          provided at the time of booking. Each property and service may have its own set of guidelines regarding cancellations, which
          can include:<br />
          1.6.1 Free Cancellation Period, conditions under which Users may cancel their booking without incurring any fees, typically
          offered within a specified time frame as outlined in the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>.<br />
          1.6.2 Partial Refunds, options for Users who cancel after the free cancellation period, which may result in a partial refund
          depending on the timing and terms outlined in the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>.<br />
          1.6.3 Non-Refundable Bookings, certain rates or promotions may be non-refundable, meaning that Users will be unable to recover
          any amounts paid upon cancellation as some conditions applicable to this outlined in the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>.<br />
          1.6.4 Refunds, Refunds, if applicable, will be processed according to the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link> linked to the booked service.
          Users should be aware that;<br />
          1.6.5 Processing time, refunds may take several business days to process, depending on the financial institution and payment
          method used. NoLSAF will communicate the expected timeline for refunds at the time of cancellation.<br />
          1.6.6 Cancellation Fees, NoLSAF reserves the right to retain a cancellation fee where stated in the <Link href="/cancellation-policy" className="text-blue-600 hover:text-blue-800 underline">Cancellation Policy</Link>. This fee
          will be deducted from the total refunded amount, and Users will be informed of any applicable fees prior to processing their
          cancellation request.<br />
          1.6.7 Requesting a Cancellation, Users wishing to cancel their bookings must initiate the cancellation process through the
          NoLSAF platform or as instructed in their booking confirmation. This ensures all cancellations are documented and processed
          efficiently.<br />
          1.6.8 Notification of Cancellation, upon successful cancellation, Users will receive a confirmation email detailing the
          cancellation, any applicable fees, and the status of any expected refunds. This email serves as an official record of the
          cancellation (<a href="mailto:cancellation@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">cancellation@nolsaf.com</a>).
        </p>

        <p>
          <strong>1.7 Applicability</strong><br />
          The Terms & Conditions apply to all Users who access or use the NoLSAF platform and services, including but not limited to:<br />
          1.7.1 Booking Services, every reservation made through the NoLSAF platform, whether for accommodations, transportation, or
          related services.<br />
          1.7.2 User Interactions, all actions taken by Users on the platform, including inquiries, payments, and communications.<br />
          1.7.3 Participation in Promotions, any participation in special offers or promotional events organized by NoLSAF.<br />
          By engaging with the NoLSAF platform, Users acknowledge and agree to adhere to these Terms & Conditions.
        </p>

        <p>
          <strong>1.8 Termination</strong><br />
          The Terms & Conditions may be terminated or rendered inactive under the following circumstances;<br />
          1.8.1 User Breach, NoLSAF reserves the right to terminate the Terms & Conditions if a User violates any part of the agreement,
          including but not limited to policies regarding payments, cancellations, or appropriate use of the platform.<br />
          1.8.2 Service Discontinuation, should NoLSAF decide to discontinue its services or the platform, the Terms & Conditions will
          terminate immediately, and Users will be notified of the cessation of services.<br />
          1.8.3 User Cancellation or Closure, if a User voluntarily cancels their account or ceases to use the NoLSAF services, the Terms &
          Conditions will no longer apply to that User’s interactions with the platform from the point of cancellation.<br />
          1.8.4 Modifications to Terms, NoLSAF reserves the right to update or modify its Terms & Conditions at any time. Users will be
          notified of significant changes, and continued use of the platform will indicate acceptance of the revised Terms.
        </p>

        <p>
          <strong>1.9 Responsibilities</strong><br />
          1.9.1 NoLSAF Responsibilities<br />
          a. Service Provision, NoLSAF is committed to providing accurate and up-to-date information regarding accommodations, services,
          and available options on the platform.<br />
          b. Property Verification, one of NoLSAF's major responsibilities is to verify and ensure that only verified properties are
          available on the platform. This verification process includes assessing the quality and reliability of properties to maintain
          high standards for Users. For full details on how properties are assessed, see our <Link href="/verification-policy" className="text-blue-600 hover:text-blue-800 underline">Verification Policy</Link>.<br />
          c. Secure Transactions, NoLSAF will facilitate secure payment processing for all bookings made through the platform, providing
          Users with a safe environment for financial transactions.<br />
          d. Customer Support, we are responsible for offering timely and effective customer support. Users can reach out to our support
          team for assistance with bookings, inquiries, or any issues that may arise.<br />
          e. Transparency in Policies, NoLSAF will communicate its Terms & Conditions, cancellation policies, and any additional fees
          clearly and transparently, ensuring that Users understand their rights and obligations.<br />
          1.9.2 User Responsibilities<br />
          a. Account Management, users are responsible for maintaining the confidentiality of their account information, including
          passwords and account details. Users must report any unauthorized access to their account promptly.<br />
          b. Accurate Information, users must provide accurate and complete information during the booking process. This includes details
          related to personal information, payment methods, and any special requests or requirements.<br />
          c. Adherence to Policies, users are responsible for complying with all Terms & Conditions, cancellation policies, and other
          relevant regulations linked to their use of the NoLSAF platform.<br />
          d. Timely Payments, users must ensure that all payments related to bookings are made in a timely manner, adhering to the payment
          terms specified during the reservation process.<br />
          e. Respect for Property and Hosts, users are expected to treat the accommodations and property Owners with respect, adhering to
          house rules and guidelines set forth by property Owners.<br />
          1.9.3 Driver Responsibilities<br />
          a. Safety and Compliance, drivers are responsible for adhering to all applicable traffic laws and safety regulations while
          providing transportation services. They must ensure the safety of their passengers and vehicle.<br />
          b. Punctuality, drivers are expected to arrive on time for scheduled pickups and drop-offs, providing reliable service to
          Users.<br />
          c. Professional Conduct, drivers should maintain a professional demeanor, treating all passengers with respect and courtesy
          throughout the transportation experience.<br />
          d. Communication, drivers must communicate promptly with Users/Traveller/customers regarding any changes to schedules or
          potential delays.<br />
          1.9.4 Agent Responsibilities<br />
          a. Representation, agents acting on behalf of Users or Owners must have explicit written authorisation and are bound by the same
          obligations as the party they represent under these Terms.<br />
          b. Accuracy, agents are responsible for ensuring that all information submitted through the platform on behalf of their clients
          is accurate, current, and complete.<br />
          c. Compliance, agents must comply with all applicable NoLSAF policies and any instructions issued by NoLSAF in relation to the
          use of the platform.<br />
          d. Liability, NoLSAF shall not be held liable for any acts, omissions, or representations made by agents acting outside the
          scope of their authorisation.
        </p>

        <p>
          <strong>1.10 Limitation of Liability</strong><br />
          1.10.1 Intermediary Role, NoLSAF acts solely as an intermediary between Users, property Owners, and Drivers. We facilitate the
          booking process and provide a platform for Users to access accommodations and transportation services but do not directly
          provide these services ourselves.<br />
          1.10.2 Verification Process, NoLSAF verifies listed properties by considering various safety measures and factors impacting the
          overall quality of the accommodations. This includes evaluating;<br />
          a. Safety Standards, compliance with relevant safety regulations and standards.<br />
          b. Environmental Concerns, assessments related to potential pollution, including noise levels, which may affect the comfort and
          experience of Users.<br />
          1.10.3 Non-Liability for Issues, NoLSAF is not liable for any issues arising from accommodations, transportation services, or
          third-party providers. This includes, but is not limited to:<br />
          a. Property Condition: We are not responsible for the state, quality, or safety of accommodations booked through our platform.<br />
          b. Service Delivery: We do not guarantee the reliability, punctuality, or quality of transportation services provided by Drivers
          or other third-party service providers.<br />
          1.10.4 Limitations on Damages, to the fullest extent permitted by law, NoLSAF will not be liable for any indirect, incidental, or
          consequential damages arising from the use of the platform or services, including but not limited to:<br />
          a. Loss of profits, savings, or data<br />
          b. Personal injury or property damage<br />
          1.10.5 User Responsibility, users acknowledge that they are responsible for all decisions regarding their travel, bookings, and
          interactions with property Owners and Drivers. It is the User’s responsibility to conduct due diligence and ensure their
          expectations are met.
        </p>

        <p>
          <strong>1.11 Privacy and Data Protection</strong><br />
          Please review our <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link> for details on how we collect, use, and protect personal information. NoLSAF is committed to
          safeguarding Users' privacy and ensuring the security of their data. By using our services, you consent to these practices and
          acknowledge that you have read and understood our <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">Privacy Policy</Link>.
          NoLSAF is operated by NoLS Africa Company Limited, which is registered as a data controller with the Personal Data Protection
          Commission under the Personal Data Protection Act, No. 11 of 2022 (Registration No. 0-000-011-671), and processes personal data
          in accordance with that Act.
        </p>

        <p>
          <strong>1.12 Intellectual Property</strong><br />
          All content on the NoLSAF website, including text, graphics, logos, images, audio, video, and all other multimedia elements, is
          the property of NoLSAF or its licensors and is protected by international copyright laws. Users are granted a limited,
          non-exclusive license to access and use this content for personal, non-commercial purposes. Any unauthorized use, reproduction,
          or distribution of the content is strictly prohibited.
        </p>

        <p>
          <strong>1.12.1 Owner Content and Marketing Use</strong><br />
          a. Ownership stays with the Owner. Photos, videos, descriptions, property names, logos and other material an Owner uploads to a
          Listing (&quot;Owner Content&quot;) remain the property of the Owner or their licensors. NoLSAF does not claim ownership of
          Owner Content.<br />
          b. Licence to NoLSAF. By uploading Owner Content, the Owner grants NoLSAF a non-exclusive, worldwide, royalty-free licence to
          use, copy, display, publish and share it to show the Listing and to promote the Listed Property and the NoLSAF platform. This
          includes the NoLSAF website and apps, social media (including Instagram, Facebook, TikTok, X, YouTube and WhatsApp), online and
          print advertising, email and SMS campaigns, and partner or affiliate channels that advertise NoLSAF stays.<br />
          c. Editing for format. NoLSAF may resize, crop, compress, reorder or caption Owner Content, add the NoLSAF name, logo or a
          booking link, and combine it with other content, so that it suits each channel. NoLSAF will not alter Owner Content in a way that
          misrepresents the Listed Property, its rooms, facilities or location.<br />
          d. No payment. The Owner is not entitled to a fee, commission or royalty for this marketing use. The benefit to the Owner is the
          extra visibility and bookings it is intended to bring.<br />
          e. Owner promises. The Owner confirms that they own Owner Content or have permission to use it and to grant this licence,
          including from any photographer, designer or agency, and that any person who can be identified in it has agreed. Owners should
          not upload photos that show guests or private documents. The Owner is responsible for any claim that Owner Content infringes
          the rights of someone else.<br />
          f. Opting out of promotion. An Owner who does not want their Listed Property featured in social media posts or advertising may
          ask NoLSAF to stop by contacting support (<a href="mailto:support@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">support@nolsaf.com</a>). NoLSAF will stop new promotional use within 14 days of the
          request. Opting out does not remove the Listing itself from the NoLSAF website and apps, which needs Owner Content to be shown
          to Users.<br />
          g. When a Listing ends. If a Listing is removed or the Owner leaves NoLSAF, NoLSAF will stop new promotional use of its Owner
          Content within 30 days. Posts, advertisements and printed material published before then may remain visible, but NoLSAF will
          not publish them again.<br />
          h. Removal requests. If any Owner Content used by NoLSAF is inaccurate, out of date or the subject of a rights complaint, the
          Owner may ask NoLSAF to take it down, and NoLSAF will act on the request promptly.
        </p>

        <p>
          <strong>1.13 Governing Law and Jurisdiction</strong><br />
          These Terms and Conditions are governed by the laws of the United Republic of Tanzania. Any disputes arising from or related to
          these Terms will be subject to the exclusive jurisdiction of the competent courts of Tanzania. Users agree to submit to the
          personal jurisdiction of these courts for the resolution of any disputes, without prejudice to any mandatory consumer
          protection rights that may apply in the User's country of residence.
        </p>

        <p>
          <strong>1.14 Complaints</strong><br />
          NoLSAF aims to provide excellent service and welcomes feedback from its Users. If Users have any complaints or concerns regarding
          their experience or our services, they should contact our customer support team directly (<a href="mailto:support@nolsaf.com" className="text-blue-600 hover:text-blue-800 underline">support@nolsaf.com</a>). We will
          investigate and address any issues raised, ensuring prompt and appropriate responses to resolve User concerns effectively.
        </p>

        <p>
          <strong>1.15 Amendments</strong><br />
          NoLSAF reserves the right to modify these Terms and Conditions at any time without prior notice. Any changes will be posted on
          our website and will become effective immediately upon posting. Users are encouraged to review these Terms regularly. Continued
          use of our services signifies acceptance of the amended terms. If Users do not agree to the new terms, they should discontinue
          use of the NoLSAF platform.
        </p>
      </div>
    ),
  },
];

