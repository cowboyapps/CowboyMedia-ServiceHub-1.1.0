import lightBgLogo from "@assets/cowboymedia_servicehub_light_trimmed.png";
import darkBgLogo from "@assets/cowboymedia_servicehub_dark_trimmed.png";

interface BrandLogoProps {
  className?: string;
  alt?: string;
  "data-testid"?: string;
}

export function BrandLogo({
  className,
  alt = "CowboyMedia",
  "data-testid": dataTestId,
}: BrandLogoProps) {
  return (
    <span className="contents" data-testid={dataTestId}>
      <img
        src={lightBgLogo}
        alt={alt}
        loading="eager"
        className={`block dark:hidden ${className ?? ""}`}
      />
      <img
        src={darkBgLogo}
        alt={alt}
        loading="eager"
        className={`hidden dark:block ${className ?? ""}`}
      />
    </span>
  );
}
