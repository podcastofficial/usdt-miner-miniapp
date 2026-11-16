// Part 14: Terms & Privacy. Default texts (the admin edits them in Settings > Legal) and the acceptance rule. Pure, no DB.
// These defaults are a STARTING TEMPLATE, not legal advice: have them checked for your country before real launch.
export const DEFAULT_TERMS = [
  "1. Who can use the app. You must be at least 18 years old and allowed by the law of your country to use a service like this.",
  "2. Points. Points are an in-app reward. They are not money, they are not a bank balance, and they can change in value or rules. The current conversion rate and minimum withdrawal are shown on the Withdraw screen.",
  "3. One person, one account. Multiple accounts, bots, fake referrals, shared wallets and any other trick to earn Points unfairly are not allowed. We may remove Points, block accounts and reject withdrawals when we find abuse.",
  "4. Withdrawals. Every withdrawal is reviewed. A new wallet address needs a short waiting time before it can be used. Send only a correct BEP-20 address: payments to a wrong address cannot be returned.",
  "5. Games and draws. Games and lucky draws use Points only, for entertainment. Results are random and not guaranteed.",
  "6. Tasks and advertising. Tasks and ads are provided by us or by advertisers. We are not responsible for the content of outside links, channels, bots or websites.",
  "7. Changes. We can change rewards, limits and these rules at any time, and we can pause the service for maintenance. If we change the Terms, you may be asked to accept them again.",
  "8. No guarantee. The service is provided as it is, without a promise of earnings or of being always available.",
].join("\n\n");

export const DEFAULT_PRIVACY = [
  "What we keep. Your Telegram ID, username, name and language, your Points history, your referral and task activity, the wallet addresses you enter, and basic technical logs.",
  "Why. To run your account, pay rewards, prevent cheating and show leaderboards. Other users only see a shortened version of your name.",
  "Who can see it. The app admins, and the services that run the app (Telegram, our hosting and database providers). Advertising networks that show ads may process data under their own policies. We do not sell your personal data.",
  "Your wallet address is used only to pay your withdrawals and to detect abuse.",
  "How long. We keep account and payment records as long as needed to run the service, to prevent fraud and to follow the law.",
  "Your choices. You can stop using the app at any time. To ask about or remove your data, contact support through the link in the app.",
].join("\n\n");

/** true when the user has accepted the CURRENT version. */
export const termsAccepted = (row, version) => Number(row && row.terms_version_accepted) === Number(version);
/** true when the admin requires acceptance and this user has not accepted the current version. */
export const termsNeeded = (cfg, row) => !!cfg && cfg.termsRequired === true && !termsAccepted(row, cfg.termsVersion);
