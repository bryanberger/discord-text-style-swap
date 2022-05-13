import { Style } from "../types";
import { sleep } from "./helpers";
import { HEADING_PREFIX, TEXT_PREFIX, TEXT_STYLES } from "./text-styles";
import listIconSvg from "bundle-text:../list-icon.svg";

type RemoteStyles = typeof TEXT_STYLES;

let numberOfNotFoundStyleIds = 0;
let nodesScanned = 0;
let allTextNodes: TextNode[] = [];

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
  const ids: Style[] = [];

  const load = (styles: RemoteStyles) =>
    styles.map(async (style) => {
      return figma.importStyleByKeyAsync(style.key).then((figmaStyle) => {
        ids.push({
          name: figmaStyle.name,
          icon: listIconSvg,
          data: {
            // this is weird, but we have to include the name in the data as well so we can do some filtering later
            name: figmaStyle.name,
            id: figmaStyle.id,
          },
        });
      });
    });

  await Promise.all(load(TEXT_STYLES));

  return ids.sort(styleSort);
}

async function getStyleIdsWithName(): Promise<Style[]> {
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
            icon: listIconSvg,
            data: {
              name: style.name,
              id: styleId,
            },
          }
        : null;
    })
    .filter((n) => n)
    .sort(styleSort) as Style[];
}

// check if node contains old style and transform to new style
async function convertOldToNewStyle(parameters: ParameterValues) {
  let numberOfNodesUpdated = 0;

  allTextNodes.forEach((node) => {
    if (typeof node.textStyleId === "symbol") {
      node
        .getStyledTextSegments(["textStyleId"])
        .forEach((segment: StyledTextSegment) => {
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

figma.on("run", async ({ parameters }: RunEvent) => {
  if (parameters) {
    const mappedParameters = {};
    mappedParameters[parameters["old-style"].id] = parameters["new-style"].id;

    await startPluginWithParameters(mappedParameters);
    figma.closePlugin();
  }
});

async function runPlugin() {
  crawlChildren(figma.currentPage.selection);

  console.log(`Scanned ${nodesScanned} nodes`);

  const foundStyles = await getStyleIdsWithName();
  const remoteStyles = await loadAllRemoteStyles();

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

      if (foundStyles.length === 0) {
        result.setError("No text styles found in your selection");
        return;
      }

      switch (key) {
        case "old-style":
          result.setSuggestions(
            foundStyles.filter((s) =>
              s.name.toLowerCase().includes(query.toLowerCase())
            )
          );
          break;
        case "new-style":
          const oldStyle = parameters["old-style"];
          const oldStyleName = oldStyle.name.toLowerCase();

          let oldStylePrefix: string;

          // If the old-style param contains one of our remote styles and the name starts with one of our text/heading prefixes
          if (
            remoteStyles.some((s) => s.data.id === oldStyle.id) &&
            (oldStyleName.startsWith(TEXT_PREFIX) ||
              oldStyleName.startsWith(HEADING_PREFIX))
          ) {
            oldStylePrefix = oldStyleName.split("/")[0] || "";
          }

          if (query) {
            result.setSuggestions(
              remoteStyles.filter((s) =>
                s.name.toLowerCase().includes(query.toLowerCase())
              )
            );
          } else {
            result.setSuggestions(
              remoteStyles.filter((s) => {
                const styleId = s.data.id;
                const styleName = s.data.name.toLowerCase();

                return (
                  styleId !== oldStyle.id && // Remove the same style, since this would do nothing
                  styleName.includes(oldStylePrefix || "") // Only show other styles with-in the same 'prefix'
                );
              })
            );
          }
          break;
        default:
          return;
      }
    }
  );
}

runPlugin();
