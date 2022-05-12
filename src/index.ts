import { Style } from "../types";
import { sleep } from "./helpers";
import { TEXT_STYLES } from "./text-styles";

type RemoteStyles = typeof TEXT_STYLES;

// figma.skipInvisibleInstanceChildren = true;

let numberOfNotFoundStyleIds = 0;
let nodesScanned = 0;
let allTextNodes = [];

const priorityStyleOrder = TEXT_STYLES.map((s) => s.name);

function styleSort(a: Style, b: Style) {
  return (
    priorityStyleOrder.indexOf(a.name) - priorityStyleOrder.indexOf(b.name)
  );
}

function crawlChildren(nodes: readonly SceneNode[]) {
  nodes.forEach((node) => {
    nodesScanned++;

    if (node.type === "TEXT") {
      allTextNodes.push(node);
    }

    if ("children" in node) {
      crawlChildren(node.children);
    }
  });
}

async function loadAllRemoteStyles(): Promise<Style[]> {
  const ids = [];

  const load = (styles: RemoteStyles) =>
    styles.map(async (style) => {
      return figma.importStyleByKeyAsync(style.key).then((figmaStyle) => {
        ids.push({
          name: figmaStyle.name,
          data: figmaStyle.id,
        });
      });
    });

  await Promise.all(load(TEXT_STYLES));

  ids.sort(styleSort);

  return ids;
}

async function getStyleIdsWithName() {
  const uniqueStyleIds = [];

  for (var i = 0; i < allTextNodes.length; i++) {
    // sleep every 500 items to avoid figma freezing
    if (i % 500 === 0) {
      await sleep(1);
    }
    // iterate over segments, if segment has a styleId, add it to the list of ids
    if (typeof allTextNodes[i].textStyleId === "symbol") {
      allTextNodes[i]
        .getStyledTextSegments(["textStyleId"])
        .forEach((segment) => {
          if (!uniqueStyleIds.includes(segment.textStyleId)) {
            uniqueStyleIds.push(segment.textStyleId);
          }
        });
    }
    //  if string, add to list of ids
    if (
      typeof allTextNodes[i].textStyleId === "string" &&
      !uniqueStyleIds.includes(allTextNodes[i].textStyleId)
    ) {
      uniqueStyleIds.push(allTextNodes[i].textStyleId);
    }
  }

  return uniqueStyleIds
    .map((styleId) => {
      const style = figma.getStyleById(styleId);
      return style
        ? {
            name: style.name,
            data: styleId,
          }
        : null;
    })
    .filter((n) => n)
    .sort(styleSort);
}

// check if node contains old style and transform to new style
async function convertOldToNewStyle(parameters: ParameterValues) {
  let numberOfNodesUpdated = 0;

  allTextNodes.forEach((node) => {
    if (typeof node.textStyleId === "symbol") {
      node.getStyledTextSegments(["textStyleId"]).forEach((segment) => {
        const isSegmentStyleExist = parameters.hasOwnProperty(
          segment.textStyleId
        );
        if (isSegmentStyleExist) {
          numberOfNodesUpdated += 1;
          node.setRangeTextStyleId(
            segment.start,
            segment.end,
            parameters[segment.textStyleId]
          );
        }
      });
    } else if (parameters.hasOwnProperty(node.textStyleId)) {
      numberOfNodesUpdated += 1;
      node.textStyleId = parameters[node.textStyleId];
    }
  });

  return numberOfNodesUpdated;
}

async function startPluginWithParameters(parameters: ParameterValues) {
  const numberOfNodesUpdated = await convertOldToNewStyle(parameters);

  if (numberOfNotFoundStyleIds === 0 && numberOfNodesUpdated > 0) {
    figma.notify(`Updated ${numberOfNodesUpdated} nodes`);
  } else if (numberOfNotFoundStyleIds === 0 && numberOfNodesUpdated === 0) {
    figma.notify(
      `No matching styles found, make sure all styles are being used in this document`
    );
  } else if (numberOfNotFoundStyleIds > 0 && numberOfNodesUpdated === 0) {
    figma.notify(`${numberOfNotFoundStyleIds} styles not found`);
  } else {
    figma.notify(
      `Updated ${numberOfNodesUpdated} nodes, ${numberOfNotFoundStyleIds} styles not found`
    );
  }
}

figma.on("run", async ({ command, parameters }: RunEvent) => {
  if (parameters) {
    const mappedParameters = {};
    mappedParameters[parameters["old-style"]] = parameters["new-style"];

    await startPluginWithParameters(mappedParameters);
    figma.closePlugin();
  }
});

async function runPlugin() {
  crawlChildren(figma.currentPage.selection);

  console.log(`Scanned ${nodesScanned} nodes`);

  const ids = await getStyleIdsWithName();
  const newIds = await loadAllRemoteStyles();

  figma.parameters.on(
    "input",
    async ({ parameters, key, query, result }: ParameterInputEvent) => {
      if (figma.currentPage.selection.length === 0) {
        result.setError("Please select one or more nodes first");
        return;
      }

      if (allTextNodes.length === 0) {
        result.setError("We couldn't find any text nodes in your selection");
        return;
      }

      switch (key) {
        case "old-style":
          result.setSuggestions(
            ids.filter((s) =>
              s.name.toLowerCase().includes(query.toLowerCase())
            )
          );
          break;
        case "new-style":
          result.setSuggestions(
            newIds.filter((s) =>
              s.name.toLowerCase().includes(query.toLowerCase())
            )
          );
          break;
        default:
          return;
      }
    }
  );
}

runPlugin();
