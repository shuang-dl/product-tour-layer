# The tour reports app on DeployBay (app tour-reports): receives tour events and shows the report pages.
# Lives at the repo root so DeployBay finds it and detects port 8080; the app is in reports/.
# One package: pg, for Postgres. package-lock.json pins the exact version.
FROM node:20-slim

WORKDIR /app
COPY reports/package.json reports/package-lock.json ./
RUN npm ci --omit=dev

COPY reports/server.mjs reports/report.js reports/index.html ./

USER node

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
