const AUTHORS = [
  { name: 'Tamara Koliada', role: 'Solution Architect', linkedin: 'https://www.linkedin.com/in/tomakoliada/', email: 'tomacolyada@gmail.com' },
  { name: 'Richard Wang', role: 'Student ETH', linkedin: 'https://www.linkedin.com/in/richard-w7/', email: 'richard04w@gmail.com' },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <span className="sf-title">Authors</span>
      <ul className="sf-authors">
        {AUTHORS.map((a) => (
          <li key={a.email}>
            <b>{a.name}</b>, {a.role} ·{' '}
            <a href={a.linkedin} target="_blank" rel="noreferrer">LinkedIn</a> ·{' '}
            <a href={`mailto:${a.email}`}>{a.email}</a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
