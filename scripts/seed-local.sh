#!/bin/bash

# Seed local development data
# This script populates the local canister with test data for development

set -e

echo "🌱 Seeding local development data..."

# Check if dfx is running
if ! dfx ping > /dev/null 2>&1; then
    echo "❌ dfx is not running. Please start dfx with 'dfx start --clean --background'"
    exit 1
fi

# Get the canister ID
CANISTER_ID=$(dfx canister id final_score 2>/dev/null || echo "")

if [ -z "$CANISTER_ID" ]; then
    echo "❌ final_score canister not found. Please deploy with 'dfx deploy final_score'"
    exit 1
fi

echo "📦 Found canister: $CANISTER_ID"

# Call the admin seed method
echo "🔧 Calling admin_seed_test_data..."
RESULT=$(dfx canister call final_score admin_seed_test_data)

if [[ $RESULT == *"ok"* ]]; then
    echo "✅ Successfully seeded test data!"
    echo ""
    echo "Test data includes:"
    echo "  🏟️  5 upcoming matches with realistic pools:"
    echo "     • Manchester United vs Liverpool"
    echo "     • Barcelona vs Real Madrid (El Clasico)"
    echo "     • Bayern Munich vs Borussia Dortmund"
    echo "     • PSG vs Marseille"
    echo "     • Chelsea vs Arsenal"
    echo ""
    echo "  👥 5 test users with various stats:"
    echo "     • High profit trader ($35 profit)"
    echo "     • High accuracy trader (90% accuracy)"
    echo "     • High volume trader ($200 wagered)"
    echo "     • Long streak trader (20 win streak)"
    echo "     • Losing trader (for comparison)"
    echo ""
    echo "📅 View schedule at: http://localhost:3000/schedule"
    echo "📊 View leaderboard at: http://localhost:3000/leaderboard"
else
    echo "❌ Failed to seed data: $RESULT"
    exit 1
fi
