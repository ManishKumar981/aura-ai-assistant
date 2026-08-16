# Aura AI Assistant

Build the foundation of a new application called:

AI Medical Voice Consultation & Clinical Note Generation System

I need a lightweight working MVP in 1–2 days.

IMPORTANT:

Do not over-engineer the project.

Do not use Ollama.

Do not use large local AI models.

Do not use Docker.

Do not use FastAPI.

Do not require a local PostgreSQL server.

Do not download large AI models.

Use a lightweight modern web architecture supported by Lovable.

Use:

- React

- TypeScript

- Tailwind CSS

- Supabase

- Supabase Auth

- Supabase PostgreSQL

- Supabase Row Level Security

The application is an ORIGINAL implementation. Do not copy code, architecture, prompts, UI components, or database schema from any existing GitHub project.

Create a clean professional medical UI.

Create these pages:

/

 /login

 /register

 /dashboard

 /assistant

 /history

 /profile

Implement Supabase authentication:

- Register

- Login

- Logout

- Protected dashboard

- Persistent session

Create these database tables:

profiles

consultations

messages

medical_points

consultation_summaries

citations

consultations must belong to a user.

messages must belong to a consultation.

messages must contain:

id

consultation_id

role

content

timestamp

Roles:

PATIENT

AI_DOCTOR

SYSTEM

Create proper Supabase Row Level Security so users can only access their own data.

Create the dashboard with:

- Welcome section

- Start New Consultation button

- Recent Consultations

- Profile section

Create the basic AI Doctor page UI, but do not implement the AI or voice yet.

The assistant page should contain placeholders for:

- conversation area

- microphone button

- text input

- send button

- end consultation button

Focus only on foundation, authentication, database, RLS, and UI.

After implementation, verify:

1. Register works.

2. Login works.

3. Logout works.

4. Dashboard is protected.

5. User can create a consultation record.

6. User can access only their own data.

Do not implement advanced AI, RAG, voice, PDF, or medical analysis yet.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0ba481d0-bd8b-416f-b836-b230493544bc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
