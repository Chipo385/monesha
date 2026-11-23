// Site settings: the one place to fill in contact details before going live.
// Everything is optional; the site adapts to whatever is set.
export const CONFIG = {
  // Where enquiries and applications go. Shown as a link on the contact section and
  // used to open the visitor's mail app if no form endpoint is set.
  email: '',

  // WhatsApp number in international format, digits only (e.g. '260971234567').
  // Adds a "Message us on WhatsApp" link next to the contact form.
  whatsapp: '',

  // Optional form backend that accepts a JSON POST (Formspree, Basin, Getform, etc.).
  // When set, forms submit in the page without opening a mail app.
  formEndpoint: '',
};
