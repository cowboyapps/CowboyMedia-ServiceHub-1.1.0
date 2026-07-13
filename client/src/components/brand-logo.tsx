import lightBgLogo from "@assets/CowboyMedia_LightBG_Wordmark_1784000000000.png";
import darkBgLogo from "@assets/CowboyMedia_Uodated_Logo_1778328129619.png";

interface BrandLogoProps {
  className?: string;
  alt?: string;
  /** Force the dark-background logo regardless of theme — for the app shell
      (sidebar/header/bottom nav), which is charcoal in BOTH light and dark. */
  onDark?: boolean;
  "data-testid"?: string;
}

export function BrandLogo({
  className,
  alt = "CowboyMedia",
  onDark = false,
  "data-testid": dataTestId,
}: BrandLogoProps) {
  if (onDark) {
    return (
      <span className="contents" data-testid={dataTestId}>
        <img
          src={darkBgLogo}
          alt={alt}
          loading="eager"
          className={`block max-w-full object-contain ${className ?? ""}`}
        />
      </span>
    );
  }
  return (
    <span className="contents" data-testid={dataTestId}>
      <img
        src={lightBgLogo}
        alt={alt}
        loading="eager"
        className={`block max-w-full object-contain dark:hidden ${className ?? ""}`}
      />
      <img
        src={darkBgLogo}
        alt={alt}
        loading="eager"
        className={`hidden max-w-full object-contain dark:block ${className ?? ""}`}
      />
    </span>
  );
}
