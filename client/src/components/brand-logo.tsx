import lightBgLogo from "@assets/CowboyMedia_Logo_LightBG_trimmed.png";
import darkBgLogo from "@assets/CowboyMedia_Uodated_Logo_1778328129619.png";

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
