#!/bin/bash
# Deployment script for af-lms
# Usage: ./scripts/deploy.sh [staging|production]

set -e

ENV=${1:-staging}

case $ENV in
  staging)
    PROJECT="af-lms"
    URL="https://af-lms.vercel.app"
    ;;
  production)
    PROJECT="af-lms-production"
    URL="https://lms.avantifellows.org"
    ;;
  *)
    echo "Usage: ./scripts/deploy.sh [staging|production]"
    echo ""
    echo "  staging     Deploy to af-lms.vercel.app (default)"
    echo "  production  Deploy to lms.avantifellows.org"
    exit 1
    ;;
esac

echo "Deploying to $ENV ($PROJECT)..."
echo ""

# Backup .env.local if it exists (vercel link overwrites it)
if [ -f .env.local ]; then
  cp .env.local .env.local.backup
  echo "Backed up .env.local"
fi

# Link to the correct project
npx vercel link --project "$PROJECT" --yes

# Deploy to production environment of that project
npx vercel --prod

# Restore .env.local
if [ -f .env.local.backup ]; then
  mv .env.local.backup .env.local
  echo "Restored .env.local"
fi

echo ""
echo "Deployed to $ENV: $URL"
