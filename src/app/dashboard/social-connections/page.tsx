"use client";

import { Share2 } from "lucide-react";
import SocialConnections from "../social-publisher/SocialConnections";

/**
 * The connections board as its own page — the founder wants it one click from
 * the sidebar, not buried under three thousand pixels of Social Publisher.
 * Access follows the Social Publisher grant (SECTION_BY_PREFIX), because the
 * people who send posts are exactly the people who need to see why one failed.
 */
export default function SocialConnectionsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
          <Share2 className="w-6 h-6 text-indigo-400" /><span>Social Connections</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          The true state of every client&apos;s social accounts — Refresh checks each one live with RecurPost,
          so a dead connection shows here before it fails a post.
        </p>
      </div>
      <SocialConnections standalone />
    </div>
  );
}
