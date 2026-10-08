// Shared by the classic-script app and the conversational Worker.
(function (root) {
  root.MealPrepReadyFoodContract = Object.freeze({
    sources: Object.freeze(['leftovers', 'takeout']),
    defaultFridgeLife: 3,
    defaultFreezerLife: 90
  });
})(globalThis);
