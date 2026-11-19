const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const POS_CODE_REGEX = /^\d{4,8}$/;

// E.164, the only format Clerk accepts for phone numbers.
const PHONE_NUMBER_REGEX = /^\+[1-9]\d{7,14}$/;

export { EMAIL_REGEX, PASSWORD_REGEX, PHONE_NUMBER_REGEX, POS_CODE_REGEX };
