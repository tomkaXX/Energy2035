import { useState } from 'react';

const AUTHORS = [
  { name: 'Tamara Koliada', role: 'Solution Architect', linkedin: 'https://www.linkedin.com/in/tomakoliada/', email: 'tomacolyada@gmail.com' },
  { name: 'Richard Wang', role: 'Student ETH', linkedin: 'https://www.linkedin.com/in/richard-w7/', email: 'richard04w@gmail.com' },
];

function MailLink({ email }) {
  const [shown, setShown] = useState(false);
  // shows only "Mail"; a click reveals the address and opens the mail program (mailto:)
  return (
    <a href={`mailto:${email}`} onClick={() => setShown(true)} title="Send an e-mail">
      {shown ? `Mail: ${email}` : 'Mail'}
    </a>
  );
}

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="sf-inner">
        <span className="sf-title">Authors</span>
        <ul className="sf-authors">
          {AUTHORS.map((a) => (
            <li key={a.email}>
              <b>{a.name}</b>, {a.role} ·{' '}
              <a href={a.linkedin} target="_blank" rel="noreferrer">LinkedIn</a> · <MailLink email={a.email} />
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
