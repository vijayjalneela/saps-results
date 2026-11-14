// Firebase settings for the Results Portal (project: saps-results).
// These values are public by design; security comes from the Firestore rules.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBYTJCfXimLmq0x7ea7TuCDQLETI8C7Al4",
  authDomain: "saps-results.firebaseapp.com",
  projectId: "saps-results",
  storageBucket: "saps-results.firebasestorage.app",
  messagingSenderId: "265175837761",
  appId: "1:265175837761:web:5ba37894f4878c84946ac0"
};

// The only account that can change the home page (school photo, principal's message).
window.ADMIN_EMAIL = "vijayjalneela@gmail.com";

// App Check (reCAPTCHA v3) site key. Paste it here after creating it at google.com/recaptcha/admin.
// While it says PASTE, App Check stays off and the site works as before.
window.RECAPTCHA_SITE_KEY = "PASTE-SITE-KEY-HERE";
