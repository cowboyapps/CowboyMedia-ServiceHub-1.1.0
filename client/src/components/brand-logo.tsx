import lightBgLogo from "@assets/CowboyApps_New_LightBG_1778505839226.png";
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
    <>
      <img
        src={lightBgLogo}
        alt={alt}
        loading="eager"
        className={`block dark:hidden ${className ?? ""}`}
        data-testid={dataTestId}
      />
      <img
        src={darkBgLogo}
        alt={alt}
        aria-hidden="true"
        loading="eager"
        className={`hidden dark:block ${className ?? ""}`}
      />
    </>
  );
}
