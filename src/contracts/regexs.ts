const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const POS_CODE_REGEX = /^\d{4,8}$/;

export { EMAIL_REGEX, PASSWORD_REGEX, POS_CODE_REGEX };
