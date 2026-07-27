import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DemoClient } from "./demo-client.js";

it("renders the public replay label and locked evidence fields", () => {
  const publicMarkup = renderToStaticMarkup(
    <DemoClient initialMode="REPLAY" deploymentProfile="PUBLIC_REPLAY" />,
  );

  expect(publicMarkup).toContain("Public fixture replay");
  expect(publicMarkup).toContain('readOnly=""');
  expect(publicMarkup).toContain('aria-readonly="true"');
});

it("keeps local replay labeled and editable", () => {
  const localMarkup = renderToStaticMarkup(
    <DemoClient initialMode="REPLAY" deploymentProfile="LOCAL" />,
  );

  expect(localMarkup).toContain("Fixture replay");
  expect(localMarkup).not.toContain("Public fixture replay");
  expect(localMarkup).not.toContain('readOnly=""');
});
