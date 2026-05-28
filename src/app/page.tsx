export default function HomePage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Clinic Booking MVP</h1>
      <p style={{ marginTop: 0, opacity: 0.85 }}>
        Multi-tenant white-label app for dental and physio clinics.
      </p>

      <section style={{ marginTop: 24 }}>
        <h2>Day-1 Focus</h2>
        <ul>
          <li>Set up tenancy model and auth scaffolding</li>
          <li>Implement doctor-first availability endpoint</li>
          <li>Create appointment booking with 1 active booking rule</li>
          <li>Add Telegram reminder abstraction with email fallback interface</li>
        </ul>
        <p>
          Sign in: <a href="/api/auth/signin">/api/auth/signin</a>
        </p>
      </section>
    </main>
  );
}
