#pragma once
#import <Foundation/Foundation.h>
#import <objc/runtime.h>

@protocol HSRNode
- (NSArray *)subviews;
- (id)superview;
@end
@protocol HSRLabel
- (NSString *)accessibilityLabelForCoopting;
@end

// The caller separately checks the pinned declared object-getter ABI.
static BOOL HSRFixedTarget(id node, Class viewClass, BOOL accessible, BOOL button) {
  if (object_getClass(node) != viewClass || !accessible || !button) return NO;
  NSString *label = [(id<HSRLabel>)node accessibilityLabelForCoopting];
  return [label isKindOfClass:NSString.class] && label.length == @"Delete all local data".length && [label isEqualToString:@"Delete all local data"];
}

@interface HSRSearch : NSObject
@property(nonatomic, strong) id target;
@property NSUInteger visited;
@property NSUInteger matches;
@property NSUInteger depth;
@property NSInteger code;
@end
@implementation HSRSearch @end

// Caller proves the Help scroll root. Never walks above it or uses AX APIs.
// Only the predicate may read the fixed authored action's identity.
static HSRSearch *HSRFind(id<HSRNode> root, BOOL (^matches)(id)) {
  HSRSearch *result = [HSRSearch new]; result.code = 2;
  try {
    @try {
      if (!root || !matches) { result.code = 6; return result; }
      NSMutableArray *nodes = [NSMutableArray arrayWithObject:root];
      NSMutableArray<NSNumber *> *depths = [NSMutableArray arrayWithObject:@0];
      NSHashTable *seen = [NSHashTable hashTableWithOptions:NSPointerFunctionsObjectPointerPersonality];
      while (nodes.count) {
        id<HSRNode> node = nodes.lastObject; NSUInteger depth = depths.lastObject.unsignedIntegerValue;
        [nodes removeLastObject]; [depths removeLastObject];
        if ([seen containsObject:node]) { result.code = 6; result.target = nil; return result; }
        [seen addObject:node]; result.visited++;
        result.depth = MAX(result.depth, depth);
        if (depth && matches(node)) {
          result.matches++;
          if (result.matches > 1) { result.code = 3; result.target = nil; return result; }
          result.target = node;
        }
        NSArray *children = node.subviews;
        if (![children isKindOfClass:NSArray.class]) { result.code = 6; result.target = nil; return result; }
        if (children.count && depth >= 16) { result.code = 5; result.target = nil; return result; }
        if (children.count > 256 - result.visited - nodes.count) { result.code = 4; result.target = nil; return result; }
        for (id<HSRNode> child in children) {
          if ([child superview] != node) { result.code = 6; result.target = nil; return result; }
          [nodes addObject:child]; [depths addObject:@(depth + 1)];
        }
      }
      result.code = result.matches == 1 ? 0 : 2;
    } @catch (__unused NSException *e) { result.code = 8; result.target = nil; }
  } catch (...) { result.code = 8; result.target = nil; }
  return result;
}
