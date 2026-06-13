// Client contact/detail rows for the /db Clients detail view.
//
// Rendered inside the ClientHeader identity block (as its children)
// so the DOM/layout is identical to the prior inline markup, where
// the contact <span> sat directly under the client name. The client
// record only carries a contact field today, so this stays a single
// row; any future client-level detail rows belong here alongside it.
export function ClientDetailRows({ contact }) {
  return contact ? <span>{contact}</span> : null;
}
