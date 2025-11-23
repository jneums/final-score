#!/bin/bash

# Rebuild leaderboard stats from existing position history
# This script is useful for populating production leaderboards from existing user data

set -e

echo "🔄 Rebuilding user stats from position history..."

# Check if network is specified
NETWORK="${1:-local}"

if [ "$NETWORK" != "local" ] && [ "$NETWORK" != "ic" ]; then
    echo "Usage: $0 [local|ic]"
    echo "  local - Rebuild stats on local dfx instance (default)"
    echo "  ic    - Rebuild stats on IC mainnet"
    exit 1
fi

# Check if dfx is running for local network
if [ "$NETWORK" = "local" ]; then
    if ! dfx ping > /dev/null 2>&1; then
        echo "❌ dfx is not running. Please start dfx with 'dfx start --background'"
        exit 1
    fi
fi

echo "📦 Target network: $NETWORK"

# Call the admin rebuild method
echo "🔧 Calling admin_rebuild_stats_from_history..."

if [ "$NETWORK" = "ic" ]; then
    RESULT=$(dfx canister --network ic call final_score admin_rebuild_stats_from_history)
else
    RESULT=$(dfx canister call final_score admin_rebuild_stats_from_history)
fi

if [[ $RESULT == *"ok"* ]]; then
    # Extract the success message
    SUCCESS_MSG=$(echo "$RESULT" | grep -oP '(?<=").*(?=")')
    echo "✅ $SUCCESS_MSG"
    echo ""
    echo "📊 Leaderboard stats have been rebuilt from historical data"
    
    if [ "$NETWORK" = "local" ]; then
        echo "View at: http://localhost:3000/leaderboard"
    else
        echo "Leaderboards are now updated on mainnet"
    fi
else
    echo "❌ Failed to rebuild stats: $RESULT"
    exit 1
fi
