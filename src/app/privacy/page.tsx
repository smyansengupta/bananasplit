import type { Metadata } from "next";

import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getSession } from "@/lib/auth/session";
import { CONTACT_EMAIL } from "@/lib/brand/links";

export const metadata: Metadata = {
  title: "Privacy Policy · Bananasplit",
  description: "How Bananasplit collects, uses and protects your personal information.",
};

const DSAR_HREF = "https://app.termly.io/dsar/0136cdcc-60d7-4db4-a80e-9169782eb5fc";

/**
 * The privacy notice, set in the site's own type,
 * inside the marketing pages' header and footer. Linked from the footer,
 * sign-up and checkout (PRIVACY_HREF).
 */
export default async function PrivacyPage() {
  const signedIn = Boolean(await getSession());
  return (
    <MarketingShell signedIn={signedIn}>
      <div className="mx-auto w-full max-w-[760px] px-6 pt-10 pb-24">
        <h1 className="display-title m-0 text-[clamp(36px,5vw,52px)] leading-[1.05] tracking-[-0.03em]">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mt-3 mb-10 text-[15px]">
          Last updated October 12, 2026
        </p>
        <div className="text-foreground/80 [&_a]:text-foreground [&_strong]:text-foreground flex flex-col gap-4 text-[16px] leading-[1.65] [&_a]:underline [&_a]:underline-offset-2 [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
          <Policy />
        </div>
      </div>
    </MarketingShell>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="heading text-foreground mt-10 mb-0 scroll-mt-6 text-[26px] leading-[1.15] tracking-[-0.02em]"
    >
      {children}
    </h2>
  );
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-foreground mt-4 mb-0 scroll-mt-6 text-[18px] font-bold">
      {children}
    </h3>
  );
}

function InShort({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 italic">
      <strong>In Short:</strong> {children}
    </p>
  );
}

function Email() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

function Dsar() {
  return (
    <a href={DSAR_HREF} target="_blank" rel="noopener noreferrer">
      data subject access request
    </a>
  );
}

const TOC = [
  ["infocollect", "1. What information do we collect?"],
  ["infouse", "2. How do we process your information?"],
  ["whoshare", "3. When and with whom do we share your personal information?"],
  ["cookies", "4. Do we use cookies and other tracking technologies?"],
  ["ai", "5. Do we offer artificial intelligence-based products?"],
  ["sociallogins", "6. How do we handle your social logins?"],
  ["inforetain", "7. How long do we keep your information?"],
  ["infosafe", "8. How do we keep your information safe?"],
  ["infominors", "9. Do we collect information from minors?"],
  ["privacyrights", "10. What are your privacy rights?"],
  ["DNT", "11. Controls for Do-Not-Track features"],
  ["uslaws", "12. Do United States residents have specific privacy rights?"],
  ["policyupdates", "13. Do we make updates to this notice?"],
  ["contact", "14. How can you contact us about this notice?"],
  ["request", "15. How can you review, update, or delete the data we collect from you?"],
] as const;

/** Categories of personal information (section 12): name, examples, collected. */
const CATEGORIES = [
  [
    "A. Identifiers",
    "Contact details, such as real name, alias, postal address, telephone or mobile contact number, unique personal identifier, online identifier, Internet Protocol address, email address, and account name",
    "YES",
  ],
  [
    "B. Personal information as defined in the California Customer Records statute",
    "Name, contact information, education, employment, employment history, and financial information",
    "NO",
  ],
  [
    "C. Protected classification characteristics under state or federal law",
    "Gender, age, date of birth, race and ethnicity, national origin, marital status, and other demographic data",
    "YES",
  ],
  [
    "D. Commercial information",
    "Transaction information, purchase history, financial details, and payment information",
    "NO",
  ],
  ["E. Biometric information", "Fingerprints and voiceprints", "NO"],
  [
    "F. Internet or other similar network activity",
    "Browsing history, search history, online behavior, interest data, and interactions with our and other websites, applications, systems, and advertisements",
    "NO",
  ],
  ["G. Geolocation data", "Device location", "NO"],
  [
    "H. Audio, electronic, sensory, or similar information",
    "Images and audio, video or call recordings created in connection with our business activities",
    "NO",
  ],
  [
    "I. Professional or employment-related information",
    "Business contact details in order to provide you our Services at a business level or job title, work history, and professional qualifications if you apply for a job with us",
    "NO",
  ],
  ["J. Education Information", "Student records and directory information", "NO"],
  [
    "K. Inferences drawn from collected personal information",
    "Inferences drawn from any of the collected personal information listed above to create a profile or summary about, for example, an individual’s preferences and characteristics",
    "NO",
  ],
  [
    "L. Sensitive personal Information",
    "Account login information and financial information including account access details",
    "YES",
  ],
] as const;

function Policy() {
  return (
    <>
      <p className="m-0">
        This Privacy Notice for Lamoureux Enterprises (&quot;<strong>we</strong>,&quot; &quot;
        <strong>us</strong>,&quot; or &quot;<strong>our</strong>&quot;), describes how and why we
        might access, collect, store, use, and/or share (&quot;<strong>process</strong>&quot;) your
        personal information when you use our services (&quot;<strong>Services</strong>&quot;),
        including when you:
      </p>
      <ul>
        <li>
          Visit our website at{" "}
          <a href="https://www.bananasplit.fyi/">https://www.bananasplit.fyi/</a> or any website of
          ours that links to this Privacy Notice
        </li>
        <li>
          Download and use our mobile application (bananasplit), or any other application of ours
          that links to this Privacy Notice
        </li>
        <li>
          Use bananasplit. Tasks, availability polls, RSVPs, notes, databases and the club budget in
          one workspace. Replace the pile of apps your board juggles today.
        </li>
        <li>Engage with us in other related ways, including any marketing or events</li>
      </ul>
      <p className="m-0">
        <strong>Questions or concerns?</strong> Reading this Privacy Notice will help you understand
        your privacy rights and choices. We are responsible for making decisions about how your
        personal information is processed. If you do not agree with our policies and practices,
        please do not use our Services. If you still have any questions or concerns, please contact
        us at <Email />.
      </p>

      <H2 id="summary">Summary of key points</H2>
      <p className="m-0">
        <strong>
          <em>
            This summary provides key points from our Privacy Notice, but you can find out more
            details about any of these topics by clicking the link following each key point or by
            using our <a href="#toc">table of contents</a> below to find the section you are looking
            for.
          </em>
        </strong>
      </p>
      <p className="m-0">
        <strong>What personal information do we process?</strong> When you visit, use, or navigate
        our Services, we may process personal information depending on how you interact with us and
        the Services, the choices you make, and the products and features you use. Learn more about{" "}
        <a href="#personalinfo">personal information you disclose to us</a>.
      </p>
      <p className="m-0">
        <strong>Do we process any sensitive personal information?</strong> Some of the information
        may be considered &quot;special&quot; or &quot;sensitive&quot; in certain jurisdictions, for
        example your racial or ethnic origins, sexual orientation, and religious beliefs. We may
        process sensitive personal information when necessary with your consent or as otherwise
        permitted by applicable law. Learn more about{" "}
        <a href="#sensitiveinfo">sensitive information we process</a>.
      </p>
      <p className="m-0">
        <strong>Do we collect any information from third parties?</strong> We do not collect any
        information from third parties.
      </p>
      <p className="m-0">
        <strong>How do we process your information?</strong> We process your information to provide,
        improve, and administer our Services, communicate with you, for security and fraud
        prevention, and to comply with law. We may also process your information for other purposes
        with your consent. We process your information only when we have a valid legal reason to do
        so. Learn more about <a href="#infouse">how we process your information</a>.
      </p>
      <p className="m-0">
        <strong>In what situations and with which parties do we share personal information?</strong>{" "}
        We may share information in specific situations and with specific third parties. Learn more
        about <a href="#whoshare">when and with whom we share your personal information</a>.
      </p>
      <p className="m-0">
        <strong>How do we keep your information safe?</strong> We have adequate organizational and
        technical processes and procedures in place to protect your personal information. However,
        no electronic transmission over the internet or information storage technology can be
        guaranteed to be 100% secure, so we cannot promise or guarantee that hackers,
        cybercriminals, or other unauthorized third parties will not be able to defeat our security
        and improperly collect, access, steal, or modify your information. Learn more about{" "}
        <a href="#infosafe">how we keep your information safe</a>.
      </p>
      <p className="m-0">
        <strong>What are your rights?</strong> Depending on where you are located geographically,
        the applicable privacy law may mean you have certain rights regarding your personal
        information. Learn more about <a href="#privacyrights">your privacy rights</a>.
      </p>
      <p className="m-0">
        <strong>How do you exercise your rights?</strong> The easiest way to exercise your rights is
        by submitting a <Dsar />, or by contacting us. We will consider and act upon any request in
        accordance with applicable data protection laws.
      </p>
      <p className="m-0">
        Want to learn more about what we do with any information we collect?{" "}
        <a href="#toc">Review the Privacy Notice in full</a>.
      </p>

      <H2 id="toc">Table of contents</H2>
      <ul>
        {TOC.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`}>{label}</a>
          </li>
        ))}
      </ul>

      <H2 id="infocollect">1. What information do we collect?</H2>
      <H3 id="personalinfo">Personal information you disclose to us</H3>
      <InShort>We collect personal information that you provide to us.</InShort>
      <p className="m-0">
        We collect personal information that you voluntarily provide to us when you register on the
        Services, express an interest in obtaining information about us or our products and
        Services, when you participate in activities on the Services, or otherwise when you contact
        us.
      </p>
      <p className="m-0">
        <strong>Personal Information Provided by You.</strong> The personal information that we
        collect depends on the context of your interactions with us and the Services, the choices
        you make, and the products and features you use. The personal information we collect may
        include the following:
      </p>
      <ul>
        <li>names</li>
        <li>phone numbers</li>
        <li>email addresses</li>
        <li>passwords</li>
      </ul>
      <p id="sensitiveinfo" className="m-0 scroll-mt-6">
        <strong>Sensitive Information.</strong> When necessary, with your consent or as otherwise
        permitted by applicable law, we process the following categories of sensitive information:
      </p>
      <ul>
        <li>financial data</li>
        <li>student data</li>
      </ul>
      <p className="m-0">
        <strong>Payment Data.</strong> We may collect data necessary to process your payment if you
        choose to make purchases, such as your payment instrument number, and the security code
        associated with your payment instrument. All payment data is handled and stored by Stripe.
        You may find their privacy notice link(s) here:{" "}
        <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
          https://stripe.com/privacy
        </a>
        .
      </p>
      <p className="m-0">
        <strong>Social Media Login Data.</strong> We may provide you with the option to register
        with us using your existing social media account details, like your Facebook, X, or other
        social media account. If you choose to register in this way, we will collect certain profile
        information about you from the social media provider, as described in the section called
        &quot;<a href="#sociallogins">How do we handle your social logins?</a>&quot; below.
      </p>
      <p className="m-0">
        <strong>Application Data.</strong> If you use our application(s), we also may collect the
        following information if you choose to provide us with access or permission:
      </p>
      <ul>
        <li>
          <em>Push Notifications.</em> We may request to send you push notifications regarding your
          account or certain features of the application(s). If you wish to opt out from receiving
          these types of communications, you may turn them off in your device&apos;s settings.
        </li>
      </ul>
      <p className="m-0">
        This information is primarily needed to maintain the security and operation of our
        application(s), for troubleshooting, and for our internal analytics and reporting purposes.
      </p>
      <p className="m-0">
        All personal information that you provide to us must be true, complete, and accurate, and
        you must notify us of any changes to such personal information.
      </p>

      <H3>Information automatically collected</H3>
      <InShort>
        Some information — such as your Internet Protocol (IP) address and/or browser and device
        characteristics — is collected automatically when you visit our Services.
      </InShort>
      <p className="m-0">
        We automatically collect certain information when you visit, use, or navigate the Services.
        This information does not reveal your specific identity (like your name or contact
        information) but may include device and usage information, such as your IP address, browser
        and device characteristics, operating system, language preferences, referring URLs, device
        name, country, location, information about how and when you use our Services, and other
        technical information. This information is primarily needed to maintain the security and
        operation of our Services, and for our internal analytics and reporting purposes.
      </p>
      <p className="m-0">The information we collect includes:</p>
      <ul>
        <li>
          <em>Log and Usage Data.</em> Log and usage data is service-related, diagnostic, usage, and
          performance information our servers automatically collect when you access or use our
          Services and which we record in log files. Depending on how you interact with us, this log
          data may include your IP address, device information, browser type, and settings and
          information about your activity in the Services (such as the date/time stamps associated
          with your usage, pages and files viewed, searches, and other actions you take such as
          which features you use), device event information (such as system activity, error reports
          (sometimes called &quot;crash dumps&quot;), and hardware settings).
        </li>
      </ul>

      <H3>Google API</H3>
      <p className="m-0">
        Our use of information received from Google APIs will adhere to{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy#limited-use"
          target="_blank"
          rel="noopener noreferrer"
        >
          Limited Use requirements
        </a>
        .
      </p>

      <H2 id="infouse">2. How do we process your information?</H2>
      <InShort>
        We process your information to provide, improve, and administer our Services, communicate
        with you, for security and fraud prevention, and to comply with law. We may also process
        your information for other purposes with your consent.
      </InShort>
      <p className="m-0">
        <strong>
          We process your personal information for a variety of reasons, depending on how you
          interact with our Services, including:
        </strong>
      </p>
      <ul>
        <li>
          <strong>
            To facilitate account creation and authentication and otherwise manage user accounts.
          </strong>{" "}
          We may process your information so you can create and log in to your account, as well as
          keep your account in working order.
        </li>
        <li>
          <strong>To respond to user inquiries/offer support to users.</strong> We may process your
          information to respond to your inquiries and solve any potential issues you might have
          with the requested service.
        </li>
        <li>
          <strong>To enable user-to-user communications.</strong> We may process your information if
          you choose to use any of our offerings that allow for communication with another user.
        </li>
        <li>
          <strong>To send you marketing and promotional communications.</strong> We may process the
          personal information you send to us for our marketing purposes, if this is in accordance
          with your marketing preferences. You can opt out of our marketing emails at any time. For
          more information, see &quot;<a href="#privacyrights">What are your privacy rights?</a>
          &quot; below.
        </li>
        <li>
          <strong>To protect our Services.</strong> We may process your information as part of our
          efforts to keep our Services safe and secure, including fraud monitoring and prevention.
        </li>
        <li>
          <strong>
            To evaluate and improve our Services, products, marketing, and your experience.
          </strong>{" "}
          We may process your information when we believe it is necessary to identify usage trends,
          determine the effectiveness of our promotional campaigns, and to evaluate and improve our
          Services, products, marketing, and your experience.
        </li>
        <li>
          <strong>To identify usage trends.</strong> We may process information about how you use
          our Services to better understand how they are being used so we can improve them.
        </li>
      </ul>

      <H2 id="whoshare">3. When and with whom do we share your personal information?</H2>
      <InShort>
        We may share information in specific situations described in this section and/or with the
        following third parties.
      </InShort>
      <p className="m-0">
        We may need to share your personal information in the following situations:
      </p>
      <ul>
        <li>
          <strong>Business Transfers.</strong> We may share or transfer your information in
          connection with, or during negotiations of, any merger, sale of company assets, financing,
          or acquisition of all or a portion of our business to another company.
        </li>
        <li>
          <strong>Other Users.</strong> When you share personal information (for example, by posting
          comments, contributions, or other content to the Services) or otherwise interact with
          public areas of the Services, such personal information may be viewed by all users and may
          be publicly made available outside the Services in perpetuity. If you interact with other
          users of our Services and register for our Services through a social network (such as
          Facebook), your contacts on the social network will see your name, profile photo, and
          descriptions of your activity. Similarly, other users will be able to view descriptions of
          your activity, communicate with you within our Services, and view your profile.
        </li>
        <li>
          <strong>Offer Wall.</strong> Our application(s) may display a third-party hosted
          &quot;offer wall.&quot; Such an offer wall allows third-party advertisers to offer virtual
          currency, gifts, or other items to users in return for the acceptance and completion of an
          advertisement offer. Such an offer wall may appear in our application(s) and be displayed
          to you based on certain data, such as your geographic area or demographic information.
          When you click on an offer wall, you will be brought to an external website belonging to
          other persons and will leave our application(s). A unique identifier, such as your user
          ID, will be shared with the offer wall provider in order to prevent fraud and properly
          credit your account with the relevant reward.
        </li>
      </ul>

      <H2 id="cookies">4. Do we use cookies and other tracking technologies?</H2>
      <InShort>
        We may use cookies and other tracking technologies to collect and store your information.
      </InShort>
      <p className="m-0">
        We may use cookies and similar tracking technologies (like web beacons and pixels) to gather
        information when you interact with our Services. Some online tracking technologies help us
        maintain the security of our Services and your account, prevent crashes, fix bugs, save your
        preferences, and assist with basic site functions.
      </p>
      <p className="m-0">
        We also permit third parties and service providers to use online tracking technologies on
        our Services for analytics and advertising, including to help manage and display
        advertisements or to tailor advertisements to your interests. The third parties and service
        providers use their technology to provide advertising about products and services tailored
        to your interests which may appear either on our Services or on other websites.
      </p>
      <p className="m-0">
        To the extent these online tracking technologies are deemed to be a
        &quot;sale&quot;/&quot;sharing&quot; (which includes targeted advertising, as defined under
        the applicable laws) under applicable US state laws, you can opt out of these online
        tracking technologies by submitting a request as described below under section &quot;
        <a href="#uslaws">Do United States residents have specific privacy rights?</a>&quot;
      </p>
      <p className="m-0">
        Specific information about how we use such technologies and how you can refuse certain
        cookies is set out in our Cookie Notice.
      </p>
      <H3>Google Analytics</H3>
      <p className="m-0">
        We may share your information with Google Analytics to track and analyze the use of the
        Services. To opt out of being tracked by Google Analytics across the Services, visit{" "}
        <a
          href="https://tools.google.com/dlpage/gaoptout"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://tools.google.com/dlpage/gaoptout
        </a>
        . For more information on the privacy practices of Google, please visit the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          Google Privacy &amp; Terms page
        </a>
        .
      </p>

      <H2 id="ai">5. Do we offer artificial intelligence-based products?</H2>
      <InShort>
        We offer products, features, or tools powered by artificial intelligence, machine learning,
        or similar technologies.
      </InShort>
      <p className="m-0">
        As part of our Services, we offer products, features, or tools powered by artificial
        intelligence, machine learning, or similar technologies (collectively, &quot;AI
        Products&quot;). These tools are designed to enhance your experience and provide you with
        innovative solutions. The terms in this Privacy Notice govern your use of the AI Products
        within our Services.
      </p>
      <H3>Use of AI Technologies</H3>
      <p className="m-0">
        We provide the AI Products through third-party service providers (&quot;AI Service
        Providers&quot;), including Anthropic. As outlined in this Privacy Notice, your input,
        output, and personal information will be shared with and processed by these AI Service
        Providers to enable your use of our AI Products for purposes outlined in &quot;
        <a href="#whoshare">When and with whom do we share your personal information?</a>&quot; You
        must not use the AI Products in any way that violates the terms or policies of any AI
        Service Provider.
      </p>
      <H3>Our AI Products</H3>
      <p className="m-0">Our AI Products are designed for the following functions:</p>
      <ul>
        <li>AI automation</li>
      </ul>
      <H3>How We Process Your Data Using AI</H3>
      <p className="m-0">
        All personal information processed using our AI Products is handled in line with our Privacy
        Notice and our agreement with third parties. This ensures high security and safeguards your
        personal information throughout the process, giving you peace of mind about your data&apos;s
        safety.
      </p>

      <H2 id="sociallogins">6. How do we handle your social logins?</H2>
      <InShort>
        If you choose to register or log in to our Services using a social media account, we may
        have access to certain information about you.
      </InShort>
      <p className="m-0">
        Our Services offer you the ability to register and log in using your third-party social
        media account details (like your Facebook or X logins). Where you choose to do this, we will
        receive certain profile information about you from your social media provider. The profile
        information we receive may vary depending on the social media provider concerned, but will
        often include your name, email address, friends list, and profile picture, as well as other
        information you choose to make public on such a social media platform.
      </p>
      <p className="m-0">
        We will use the information we receive only for the purposes that are described in this
        Privacy Notice or that are otherwise made clear to you on the relevant Services. Please note
        that we do not control, and are not responsible for, other uses of your personal information
        by your third-party social media provider. We recommend that you review their privacy notice
        to understand how they collect, use, and share your personal information, and how you can
        set your privacy preferences on their sites and apps.
      </p>

      <H2 id="inforetain">7. How long do we keep your information?</H2>
      <InShort>
        We keep your information for as long as necessary to fulfill the purposes outlined in this
        Privacy Notice unless otherwise required by law.
      </InShort>
      <p className="m-0">
        We will only keep your personal information for as long as it is necessary for the purposes
        set out in this Privacy Notice, unless a longer retention period is required or permitted by
        law (such as tax, accounting, or other legal requirements). No purpose in this notice will
        require us keeping your personal information for longer than the period of time in which
        users have an account with us.
      </p>
      <p className="m-0">
        When we have no ongoing legitimate business need to process your personal information, we
        will either delete or anonymize such information, or, if this is not possible (for example,
        because your personal information has been stored in backup archives), then we will securely
        store your personal information and isolate it from any further processing until deletion is
        possible.
      </p>

      <H2 id="infosafe">8. How do we keep your information safe?</H2>
      <InShort>
        We aim to protect your personal information through a system of organizational and technical
        security measures.
      </InShort>
      <p className="m-0">
        We have implemented appropriate and reasonable technical and organizational security
        measures designed to protect the security of any personal information we process. However,
        despite our safeguards and efforts to secure your information, no electronic transmission
        over the Internet or information storage technology can be guaranteed to be 100% secure, so
        we cannot promise or guarantee that hackers, cybercriminals, or other unauthorized third
        parties will not be able to defeat our security and improperly collect, access, steal, or
        modify your information. Although we will do our best to protect your personal information,
        transmission of personal information to and from our Services is at your own risk. You
        should only access the Services within a secure environment.
      </p>

      <H2 id="infominors">9. Do we collect information from minors?</H2>
      <InShort>
        We do not knowingly collect data from or market to children under 18 years of age.
      </InShort>
      <p className="m-0">
        We do not knowingly collect, solicit data from, or market to children under 18 years of age,
        nor do we knowingly sell such personal information. By using the Services, you represent
        that you are at least 18 or that you are the parent or guardian of such a minor and consent
        to such minor dependent’s use of the Services. If we learn that personal information from
        users less than 18 years of age has been collected, we will deactivate the account and take
        reasonable measures to promptly delete such data from our records. If you become aware of
        any data we may have collected from children under age 18, please contact us at <Email />.
      </p>

      <H2 id="privacyrights">10. What are your privacy rights?</H2>
      <InShort>
        You may review, change, or terminate your account at any time, depending on your country,
        province, or state of residence.
      </InShort>
      <p id="withdrawconsent" className="m-0 scroll-mt-6">
        <strong>
          <u>Withdrawing your consent:</u>
        </strong>{" "}
        If we are relying on your consent to process your personal information, which may be express
        and/or implied consent depending on the applicable law, you have the right to withdraw your
        consent at any time. You can withdraw your consent at any time by contacting us by using the
        contact details provided in the section &quot;
        <a href="#contact">How can you contact us about this notice?</a>&quot; below.
      </p>
      <p className="m-0">
        However, please note that this will not affect the lawfulness of the processing before its
        withdrawal nor, when applicable law allows, will it affect the processing of your personal
        information conducted in reliance on lawful processing grounds other than consent.
      </p>
      <p className="m-0">
        <strong>
          <u>Opting out of marketing and promotional communications:</u>
        </strong>{" "}
        You can unsubscribe from our marketing and promotional communications at any time by
        clicking on the unsubscribe link in the emails that we send, replying &quot;STOP&quot; or
        &quot;UNSUBSCRIBE&quot; to the SMS messages that we send, or by contacting us using the
        details provided in the section &quot;
        <a href="#contact">How can you contact us about this notice?</a>&quot; below. You will then
        be removed from the marketing lists. However, we may still communicate with you — for
        example, to send you service-related messages that are necessary for the administration and
        use of your account, to respond to service requests, or for other non-marketing purposes.
      </p>
      <p className="m-0">
        No mobile information will be shared with third parties or affiliates for marketing or
        promotional purposes. Information sharing to subcontractors in support services, such as
        customer service, is permitted. All other use case categories exclude text messaging
        originator opt-in data and consent; this information will not be shared with third parties.
      </p>
      <H3>Account Information</H3>
      <p className="m-0">
        If you would at any time like to review or change the information in your account or
        terminate your account, you can:
      </p>
      <ul>
        <li>Log in to your account settings and update your user account.</li>
        <li>Contact us using the contact information provided.</li>
      </ul>
      <p className="m-0">
        Upon your request to terminate your account, we will deactivate or delete your account and
        information from our active databases. However, we may retain some information in our files
        to prevent fraud, troubleshoot problems, assist with any investigations, enforce our legal
        terms and/or comply with applicable legal requirements.
      </p>
      <p className="m-0">
        If you have questions or comments about your privacy rights, you may email us at <Email />.
      </p>

      <H2 id="DNT">11. Controls for Do-Not-Track features</H2>
      <p className="m-0">
        Most web browsers and some mobile operating systems and mobile applications include a
        Do-Not-Track (&quot;DNT&quot;) feature or setting you can activate to signal your privacy
        preference not to have data about your online browsing activities monitored and collected.
        At this stage, no uniform technology standard for recognizing and implementing DNT signals
        has been finalized. As such, we do not currently respond to DNT browser signals or any other
        mechanism that automatically communicates your choice not to be tracked online. If a
        standard for online tracking is adopted that we must follow in the future, we will inform
        you about that practice in a revised version of this Privacy Notice.
      </p>
      <p className="m-0">
        California law requires us to let you know how we respond to web browser DNT signals.
        Because there currently is not an industry or legal standard for recognizing or honoring DNT
        signals, we do not respond to them at this time.
      </p>

      <H2 id="uslaws">12. Do United States residents have specific privacy rights?</H2>
      <InShort>
        If you are a resident of California, Colorado, Connecticut, Delaware, Florida, Indiana,
        Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon,
        Rhode Island, Tennessee, Texas, Utah, or Virginia, you may have the right to request access
        to and receive details about the personal information we maintain about you and how we have
        processed it, correct inaccuracies, get a copy of, or delete your personal information. You
        may also have the right to withdraw your consent to our processing of your personal
        information. These rights may be limited in some circumstances by applicable law. More
        information is provided below.
      </InShort>
      <H3>Categories of Personal Information We Collect</H3>
      <p className="m-0">
        The table below shows the categories of personal information we have collected in the past
        twelve (12) months. The table includes illustrative examples of each category and does not
        reflect the personal information we collect from you. For a comprehensive inventory of all
        personal information we process, please refer to the section &quot;
        <a href="#infocollect">What information do we collect?</a>&quot;
      </p>
      <div className="border-border overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[520px] border-collapse text-left text-[14px] leading-normal">
          <thead>
            <tr className="border-border text-foreground border-b">
              <th scope="col" className="px-4 py-3 font-bold">
                Category
              </th>
              <th scope="col" className="px-4 py-3 font-bold">
                Examples
              </th>
              <th scope="col" className="px-4 py-3 font-bold">
                Collected
              </th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map(([category, examples, collected]) => (
              <tr key={category} className="border-border border-t align-top">
                <th scope="row" className="text-foreground px-4 py-3 font-semibold">
                  {category}
                </th>
                <td className="px-4 py-3">{examples}</td>
                <td className="text-foreground px-4 py-3 font-semibold">{collected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0">
        We only collect sensitive personal information, as defined by applicable privacy laws or the
        purposes allowed by law or with your consent. Sensitive personal information may be used, or
        disclosed to a service provider or contractor, for additional, specified purposes. You may
        have the right to limit the use or disclosure of your sensitive personal information. We do
        not collect or process sensitive personal information for the purpose of inferring
        characteristics about you.
      </p>
      <p className="m-0">
        We may also collect other personal information outside of these categories through instances
        where you interact with us in person, online, or by phone or mail in the context of:
      </p>
      <ul>
        <li>Receiving help through our customer support channels;</li>
        <li>Participation in customer surveys or contests; and</li>
        <li>Facilitation in the delivery of our Services and to respond to your inquiries.</li>
      </ul>
      <p className="m-0">
        We will use and retain the collected personal information as needed to provide the Services
        or for:
      </p>
      <ul>
        <li>Category A - As long as the user has an account with us</li>
        <li>Category C - As long as the user has an account with us</li>
        <li>Category L - As long as the user has an account with us</li>
      </ul>
      <H3>Sources of Personal Information</H3>
      <p className="m-0">
        Learn more about the sources of personal information we collect in &quot;
        <a href="#infocollect">What information do we collect?</a>&quot;
      </p>
      <H3>How We Use and Share Personal Information</H3>
      <p className="m-0">
        Learn more about how we use your personal information in the section, &quot;
        <a href="#infouse">How do we process your information?</a>&quot;
      </p>
      <p className="m-0">
        <strong>Will your information be shared with anyone else?</strong>
      </p>
      <p className="m-0">
        We may disclose your personal information with our service providers pursuant to a written
        contract between us and each service provider. Learn more about how we disclose personal
        information to in the section, &quot;
        <a href="#whoshare">When and with whom do we share your personal information?</a>&quot;
      </p>
      <p className="m-0">
        We may use your personal information for our own business purposes, such as for undertaking
        internal research for technological development and demonstration. This is not considered to
        be &quot;selling&quot; of your personal information.
      </p>
      <p className="m-0">
        We have not disclosed, sold, or shared any personal information to third parties for a
        business or commercial purpose in the preceding twelve (12) months. We will not sell or
        share personal information in the future belonging to website visitors, users, and other
        consumers.
      </p>
      <H3>Your Rights</H3>
      <p className="m-0">
        You have rights under certain US state data protection laws. However, these rights are not
        absolute, and in certain cases, we may decline your request as permitted by law. These
        rights include:
      </p>
      <ul>
        <li>
          <strong>Right to know</strong> whether or not we are processing your personal data
        </li>
        <li>
          <strong>Right to access</strong> your personal data
        </li>
        <li>
          <strong>Right to correct</strong> inaccuracies in your personal data
        </li>
        <li>
          <strong>Right to request</strong> the deletion of your personal data
        </li>
        <li>
          <strong>Right to obtain a copy</strong> of the personal data you previously shared with us
        </li>
        <li>
          <strong>Right to non-discrimination</strong> for exercising your rights
        </li>
        <li>
          <strong>Right to opt out</strong> of the processing of your personal data if it is used
          for targeted advertising (or sharing as defined under California’s privacy law), the sale
          of personal data, or profiling in furtherance of decisions that produce legal or similarly
          significant effects (&quot;profiling&quot;)
        </li>
      </ul>
      <p className="m-0">
        Depending upon the state where you live, you may also have the following rights:
      </p>
      <ul>
        <li>
          Right to access the categories of personal data being processed (as permitted by
          applicable law, including the privacy law in Minnesota)
        </li>
        <li>
          Right to obtain a list of the categories of third parties to which we have disclosed
          personal data (as permitted by applicable law, including the privacy law in California,
          Delaware, and Maryland)
        </li>
        <li>
          Right to obtain a list of specific third parties to which we have disclosed personal data
          (as permitted by applicable law, including the privacy law in Minnesota and Oregon)
        </li>
        <li>
          Right to obtain a list of third parties to which we have sold personal data (as permitted
          by applicable law, including the privacy law in Connecticut)
        </li>
        <li>
          Right to review, understand, question, and depending on where you live, correct how
          personal data has been profiled (as permitted by applicable law, including the privacy law
          in Connecticut and Minnesota)
        </li>
        <li>
          Right to limit use and disclosure of sensitive personal data (as permitted by applicable
          law, including the privacy law in California)
        </li>
        <li>
          Right to opt out of the collection of sensitive data and personal data collected through
          the operation of a voice or facial recognition feature (as permitted by applicable law,
          including the privacy law in Florida)
        </li>
      </ul>
      <H3>How to Exercise Your Rights</H3>
      <p className="m-0">
        To exercise these rights, you can contact us by submitting a <Dsar />, by emailing us at{" "}
        <Email />, or by referring to the contact details at the bottom of this document.
      </p>
      <p className="m-0">
        Under certain US state data protection laws, you can designate an authorized agent to make a
        request on your behalf. We may deny a request from an authorized agent that does not submit
        proof that they have been validly authorized to act on your behalf in accordance with
        applicable laws.
      </p>
      <H3>Request Verification</H3>
      <p className="m-0">
        Upon receiving your request, we will need to verify your identity to determine you are the
        same person about whom we have the information in our system. We will only use personal
        information provided in your request to verify your identity or authority to make the
        request. However, if we cannot verify your identity from the information already maintained
        by us, we may request that you provide additional information for the purposes of verifying
        your identity and for security or fraud-prevention purposes.
      </p>
      <p className="m-0">
        If you submit the request through an authorized agent, we may need to collect additional
        information to verify your identity before processing your request and the agent will need
        to provide a written and signed permission from you to submit such request on your behalf.
      </p>
      <H3>Appeals</H3>
      <p className="m-0">
        Under certain US state data protection laws, if we decline to take action regarding your
        request, you may appeal our decision by emailing us at <Email />. We will inform you in
        writing of any action taken or not taken in response to the appeal, including a written
        explanation of the reasons for the decisions. If your appeal is denied, you may submit a
        complaint to your state attorney general.
      </p>
      <H3>California &quot;Shine The Light&quot; Law</H3>
      <p className="m-0">
        California Civil Code Section 1798.83, also known as the &quot;Shine The Light&quot; law,
        permits our users who are California residents to request and obtain from us, once a year
        and free of charge, information about categories of personal information (if any) we
        disclosed to third parties for direct marketing purposes and the names and addresses of all
        third parties with which we shared personal information in the immediately preceding
        calendar year. If you are a California resident and would like to make such a request,
        please submit your request in writing to us by using the contact details provided in the
        section &quot;<a href="#contact">How can you contact us about this notice?</a>&quot;
      </p>

      <H2 id="policyupdates">13. Do we make updates to this notice?</H2>
      <InShort>
        Yes, we will update this notice as necessary to stay compliant with relevant laws.
      </InShort>
      <p className="m-0">
        We may update this Privacy Notice from time to time. The updated version will be indicated
        by an updated &quot;Revised&quot; date at the top of this Privacy Notice. If we make
        material changes to this Privacy Notice, we may notify you either by prominently posting a
        notice of such changes or by directly sending you a notification. We encourage you to review
        this Privacy Notice frequently to be informed of how we are protecting your information.
      </p>

      <H2 id="contact">14. How can you contact us about this notice?</H2>
      <p className="m-0">
        If you have questions or comments about this notice, you may email us at <Email /> or
        contact us by post at:
      </p>
      <address className="m-0 not-italic">
        Lamoureux Enterprises
        <br />
        885 Bunn Hill Road
        <br />
        Vestal, NY 13850
        <br />
        United States
      </address>

      <H2 id="request">15. How can you review, update, or delete the data we collect from you?</H2>
      <p className="m-0">
        Based on the applicable laws of your country or state of residence in the US, you may have
        the right to request access to the personal information we collect from you, details about
        how we have processed it, correct inaccuracies, or delete your personal information. You may
        also have the right to withdraw your consent to our processing of your personal information.
        These rights may be limited in some circumstances by applicable law. To request to review,
        update, or delete your personal information, please fill out and submit a <Dsar />.
      </p>
    </>
  );
}
