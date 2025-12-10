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

# Link to the correct project
vercel link --project "$PROJECT" --yes

# Deploy to production environment of that project
vercel --prod

echo ""
echo "Deployed to $ENV: $URL"
