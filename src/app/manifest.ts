import type { MetadataRoute } from "next";

/** Lets phones and iPads add the app to the home screen and open it full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Taamara Taamara",
    short_name: "Taamara",
    description: "Bookings, vendors, crew, tasks and money in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
