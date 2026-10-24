import { createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import StaticHtml from "../node_modules/@astrojs/react/dist/static-html.js";

function isAlreadyHydrated(element) {
  for (const key in element) {
    if (key.startsWith("__reactContainer")) return key;
  }
}

const reactPropsMap = { class: "className", for: "htmlFor" };
let clientIds = 0;

function createReactElementFromDOMElement(element, id, key) {
  if (id === undefined) {
    clientIds += 1;
    id = clientIds;
    key = 0;
  }
  const attrs = {};
  for (const attr of element.attributes) {
    attrs[reactPropsMap[attr.name] || attr.name] = attr.value;
  }
  attrs.key = `${id}-${key}`;
  if (element.firstChild === null) return createElement(element.localName, attrs);
  let childKey = 0;
  return createElement(
    element.localName,
    attrs,
    Array.from(element.childNodes)
      .map((child) => {
        if (child.nodeType === Node.TEXT_NODE) return child.data;
        if (child.nodeType === Node.ELEMENT_NODE) {
          childKey += 1;
          return createReactElementFromDOMElement(child, id, childKey);
        }
        return undefined;
      })
      .filter(Boolean),
  );
}

function getChildren(childString, experimentalReactChildren) {
  if (experimentalReactChildren && childString) {
    const template = document.createElement("template");
    template.innerHTML = childString;
    return Array.from(template.content.children).map((child) => createReactElementFromDOMElement(child));
  }
  if (childString) return createElement(StaticHtml, { value: childString });
  return undefined;
}

const rootMap = new WeakMap();

export default (element) => (Component, props, { default: children, ...slotted }, { client }) => {
  if (!element.hasAttribute("ssr")) return;
  const actionKey = element.getAttribute("data-action-key");
  const actionName = element.getAttribute("data-action-name");
  const stringifiedActionResult = element.getAttribute("data-action-result");
  const formState =
    actionKey && actionName && stringifiedActionResult
      ? [JSON.parse(stringifiedActionResult), actionKey, actionName]
      : undefined;
  const renderOptions = {
    identifierPrefix: element.getAttribute("prefix"),
    formState,
  };
  for (const [key, value] of Object.entries(slotted)) {
    props[key] = createElement(StaticHtml, { value, name: key });
  }
  const componentEl = createElement(Component, props, getChildren(children, element.hasAttribute("data-react-children")));
  const rootKey = isAlreadyHydrated(element);
  if (rootKey) delete element[rootKey];

  const existing = rootMap.get(element);
  if (existing) {
    existing.render(componentEl);
    return;
  }
  const root =
    client === "only"
      ? createRoot(element)
      : hydrateRoot(element, componentEl, renderOptions);
  if (client === "only") root.render(componentEl);
  element.addEventListener("astro:unmount", () => root.unmount(), { once: true });
  rootMap.set(element, root);
};
