"use client";

/**
 * Native video-testimonial gallery for the public /testimonials page.
 *
 * Renders the videos an admin has "featured" (from the /testimonials/videos
 * manager). Plays straight from R2 through the public, featured-only playback
 * route. Shown ALONGSIDE the existing Senja written-reviews widget, not instead
 * of it. Phone-recorded clips are portrait, so cards use a 9:16 frame.
 */

export type GalleryItem = {
  id: number;
  clientName: string;
};

export default function PublicVideoGallery({ items }: { items: GalleryItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <section style={{ marginBottom: 56 }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--text-primary)",
          margin: "0 0 18px",
          textAlign: "center",
        }}
      >
        Hear it from our clients
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {items.map((item) => (
          <figure
            key={item.id}
            style={{
              margin: 0,
              borderRadius: 14,
              overflow: "hidden",
              background: "var(--bg-card, #111)",
              border: "1px solid var(--border-primary)",
            }}
          >
            <video
              src={`/api/testimonials/video/public/${item.id}`}
              controls
              playsInline
              preload="metadata"
              style={{
                width: "100%",
                aspectRatio: "9 / 16",
                background: "#000",
                objectFit: "contain",
                display: "block",
              }}
            />
            <figcaption
              style={{
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {item.clientName}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
