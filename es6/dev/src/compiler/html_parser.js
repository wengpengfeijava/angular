var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") return Reflect.decorate(decorators, target, key, desc);
    switch (arguments.length) {
        case 2: return decorators.reduceRight(function(o, d) { return (d && d(o)) || o; }, target);
        case 3: return decorators.reduceRight(function(o, d) { return (d && d(target, key)), void 0; }, void 0);
        case 4: return decorators.reduceRight(function(o, d) { return (d && d(target, key, o)) || o; }, desc);
    }
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { isPresent, isBlank, RegExpWrapper } from 'angular2/src/facade/lang';
import { ListWrapper } from 'angular2/src/facade/collection';
import { HtmlAttrAst, HtmlTextAst, HtmlElementAst } from './html_ast';
import { Injectable } from 'angular2/src/core/di';
import { HtmlTokenType, tokenizeHtml } from './html_lexer';
import { ParseError, ParseSourceSpan } from './parse_util';
import { getHtmlTagDefinition } from './html_tags';
export class HtmlTreeError extends ParseError {
    constructor(elementName, location, msg) {
        super(location, msg);
        this.elementName = elementName;
    }
    static create(elementName, location, msg) {
        return new HtmlTreeError(elementName, location, msg);
    }
}
export class HtmlParseTreeResult {
    constructor(rootNodes, errors) {
        this.rootNodes = rootNodes;
        this.errors = errors;
    }
}
export let HtmlParser = class {
    parse(sourceContent, sourceUrl) {
        var tokensAndErrors = tokenizeHtml(sourceContent, sourceUrl);
        var treeAndErrors = new TreeBuilder(tokensAndErrors.tokens).build();
        return new HtmlParseTreeResult(treeAndErrors.rootNodes, tokensAndErrors.errors
            .concat(treeAndErrors.errors));
    }
};
HtmlParser = __decorate([
    Injectable(), 
    __metadata('design:paramtypes', [])
], HtmlParser);
class TreeBuilder {
    constructor(tokens) {
        this.tokens = tokens;
        this.index = -1;
        this.rootNodes = [];
        this.errors = [];
        this.elementStack = [];
        this._advance();
    }
    build() {
        while (this.peek.type !== HtmlTokenType.EOF) {
            if (this.peek.type === HtmlTokenType.TAG_OPEN_START) {
                this._consumeStartTag(this._advance());
            }
            else if (this.peek.type === HtmlTokenType.TAG_CLOSE) {
                this._consumeEndTag(this._advance());
            }
            else if (this.peek.type === HtmlTokenType.CDATA_START) {
                this._closeVoidElement();
                this._consumeCdata(this._advance());
            }
            else if (this.peek.type === HtmlTokenType.COMMENT_START) {
                this._closeVoidElement();
                this._consumeComment(this._advance());
            }
            else if (this.peek.type === HtmlTokenType.TEXT ||
                this.peek.type === HtmlTokenType.RAW_TEXT ||
                this.peek.type === HtmlTokenType.ESCAPABLE_RAW_TEXT) {
                this._closeVoidElement();
                this._consumeText(this._advance());
            }
            else {
                // Skip all other tokens...
                this._advance();
            }
        }
        return new HtmlParseTreeResult(this.rootNodes, this.errors);
    }
    _advance() {
        var prev = this.peek;
        if (this.index < this.tokens.length - 1) {
            // Note: there is always an EOF token at the end
            this.index++;
        }
        this.peek = this.tokens[this.index];
        return prev;
    }
    _advanceIf(type) {
        if (this.peek.type === type) {
            return this._advance();
        }
        return null;
    }
    _consumeCdata(startToken) {
        this._consumeText(this._advance());
        this._advanceIf(HtmlTokenType.CDATA_END);
    }
    _consumeComment(startToken) {
        this._advanceIf(HtmlTokenType.RAW_TEXT);
        this._advanceIf(HtmlTokenType.COMMENT_END);
    }
    _consumeText(token) {
        this._addToParent(new HtmlTextAst(token.parts[0], token.sourceSpan));
    }
    _closeVoidElement() {
        if (this.elementStack.length > 0) {
            let el = ListWrapper.last(this.elementStack);
            if (getHtmlTagDefinition(el.name).isVoid) {
                this.elementStack.pop();
            }
        }
    }
    _consumeStartTag(startTagToken) {
        var prefix = startTagToken.parts[0];
        var name = startTagToken.parts[1];
        var attrs = [];
        while (this.peek.type === HtmlTokenType.ATTR_NAME) {
            attrs.push(this._consumeAttr(this._advance()));
        }
        var fullName = getElementFullName(prefix, name, this._getParentElement());
        var selfClosing = false;
        // Note: There could have been a tokenizer error
        // so that we don't get a token for the end tag...
        if (this.peek.type === HtmlTokenType.TAG_OPEN_END_VOID) {
            this._advance();
            selfClosing = true;
            if (namespacePrefix(fullName) == null && !getHtmlTagDefinition(fullName).isVoid) {
                this.errors.push(HtmlTreeError.create(fullName, startTagToken.sourceSpan.start, `Only void and foreign elements can be self closed "${startTagToken.parts[1]}"`));
            }
        }
        else if (this.peek.type === HtmlTokenType.TAG_OPEN_END) {
            this._advance();
            selfClosing = false;
        }
        var end = this.peek.sourceSpan.start;
        var el = new HtmlElementAst(fullName, attrs, [], new ParseSourceSpan(startTagToken.sourceSpan.start, end));
        this._pushElement(el);
        if (selfClosing) {
            this._popElement(fullName);
        }
    }
    _pushElement(el) {
        if (this.elementStack.length > 0) {
            var parentEl = ListWrapper.last(this.elementStack);
            if (getHtmlTagDefinition(parentEl.name).isClosedByChild(el.name)) {
                this.elementStack.pop();
            }
        }
        var tagDef = getHtmlTagDefinition(el.name);
        var parentEl = this._getParentElement();
        if (tagDef.requireExtraParent(isPresent(parentEl) ? parentEl.name : null)) {
            var newParent = new HtmlElementAst(tagDef.parentToAdd, [], [el], el.sourceSpan);
            this._addToParent(newParent);
            this.elementStack.push(newParent);
            this.elementStack.push(el);
        }
        else {
            this._addToParent(el);
            this.elementStack.push(el);
        }
    }
    _consumeEndTag(endTagToken) {
        var fullName = getElementFullName(endTagToken.parts[0], endTagToken.parts[1], this._getParentElement());
        if (getHtmlTagDefinition(fullName).isVoid) {
            this.errors.push(HtmlTreeError.create(fullName, endTagToken.sourceSpan.start, `Void elements do not have end tags "${endTagToken.parts[1]}"`));
        }
        else if (!this._popElement(fullName)) {
            this.errors.push(HtmlTreeError.create(fullName, endTagToken.sourceSpan.start, `Unexpected closing tag "${endTagToken.parts[1]}"`));
        }
    }
    _popElement(fullName) {
        for (let stackIndex = this.elementStack.length - 1; stackIndex >= 0; stackIndex--) {
            let el = this.elementStack[stackIndex];
            if (el.name.toLowerCase() == fullName.toLowerCase()) {
                ListWrapper.splice(this.elementStack, stackIndex, this.elementStack.length - stackIndex);
                return true;
            }
            if (!getHtmlTagDefinition(el.name).closedByParent) {
                return false;
            }
        }
        return false;
    }
    _consumeAttr(attrName) {
        var fullName = mergeNsAndName(attrName.parts[0], attrName.parts[1]);
        var end = attrName.sourceSpan.end;
        var value = '';
        if (this.peek.type === HtmlTokenType.ATTR_VALUE) {
            var valueToken = this._advance();
            value = valueToken.parts[0];
            end = valueToken.sourceSpan.end;
        }
        return new HtmlAttrAst(fullName, value, new ParseSourceSpan(attrName.sourceSpan.start, end));
    }
    _getParentElement() {
        return this.elementStack.length > 0 ? ListWrapper.last(this.elementStack) : null;
    }
    _addToParent(node) {
        var parent = this._getParentElement();
        if (isPresent(parent)) {
            parent.children.push(node);
        }
        else {
            this.rootNodes.push(node);
        }
    }
}
function mergeNsAndName(prefix, localName) {
    return isPresent(prefix) ? `@${prefix}:${localName}` : localName;
}
function getElementFullName(prefix, localName, parentElement) {
    if (isBlank(prefix)) {
        prefix = getHtmlTagDefinition(localName).implicitNamespacePrefix;
        if (isBlank(prefix) && isPresent(parentElement)) {
            prefix = namespacePrefix(parentElement.name);
        }
    }
    return mergeNsAndName(prefix, localName);
}
var NS_PREFIX_RE = /^@([^:]+)/g;
function namespacePrefix(elementName) {
    var match = RegExpWrapper.firstMatch(NS_PREFIX_RE, elementName);
    return isBlank(match) ? null : match[1];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaHRtbF9wYXJzZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhbmd1bGFyMi9zcmMvY29tcGlsZXIvaHRtbF9wYXJzZXIudHMiXSwibmFtZXMiOlsiSHRtbFRyZWVFcnJvciIsIkh0bWxUcmVlRXJyb3IuY29uc3RydWN0b3IiLCJIdG1sVHJlZUVycm9yLmNyZWF0ZSIsIkh0bWxQYXJzZVRyZWVSZXN1bHQiLCJIdG1sUGFyc2VUcmVlUmVzdWx0LmNvbnN0cnVjdG9yIiwiSHRtbFBhcnNlciIsIkh0bWxQYXJzZXIucGFyc2UiLCJUcmVlQnVpbGRlciIsIlRyZWVCdWlsZGVyLmNvbnN0cnVjdG9yIiwiVHJlZUJ1aWxkZXIuYnVpbGQiLCJUcmVlQnVpbGRlci5fYWR2YW5jZSIsIlRyZWVCdWlsZGVyLl9hZHZhbmNlSWYiLCJUcmVlQnVpbGRlci5fY29uc3VtZUNkYXRhIiwiVHJlZUJ1aWxkZXIuX2NvbnN1bWVDb21tZW50IiwiVHJlZUJ1aWxkZXIuX2NvbnN1bWVUZXh0IiwiVHJlZUJ1aWxkZXIuX2Nsb3NlVm9pZEVsZW1lbnQiLCJUcmVlQnVpbGRlci5fY29uc3VtZVN0YXJ0VGFnIiwiVHJlZUJ1aWxkZXIuX3B1c2hFbGVtZW50IiwiVHJlZUJ1aWxkZXIuX2NvbnN1bWVFbmRUYWciLCJUcmVlQnVpbGRlci5fcG9wRWxlbWVudCIsIlRyZWVCdWlsZGVyLl9jb25zdW1lQXR0ciIsIlRyZWVCdWlsZGVyLl9nZXRQYXJlbnRFbGVtZW50IiwiVHJlZUJ1aWxkZXIuX2FkZFRvUGFyZW50IiwibWVyZ2VOc0FuZE5hbWUiLCJnZXRFbGVtZW50RnVsbE5hbWUiLCJuYW1lc3BhY2VQcmVmaXgiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O09BQU8sRUFDTCxTQUFTLEVBQ1QsT0FBTyxFQUtQLGFBQWEsRUFHZCxNQUFNLDBCQUEwQjtPQUUxQixFQUFDLFdBQVcsRUFBQyxNQUFNLGdDQUFnQztPQUVuRCxFQUFVLFdBQVcsRUFBRSxXQUFXLEVBQUUsY0FBYyxFQUFDLE1B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QUNBLE1BQU1BLENBQUNBLElBQUlBLFNBQVNBLENBQUNBLGFBQWFBLENBQUNBLENBQUNBLENBQUNBLENBQUNBO1lBQ2hEQSxNQUFNQSxHQUFHQSxlQUFlQSxDQUFDQSxhQUFhQSxDQUFDQSxJQUFJQSxDQUFDQSxDQUFDQTtRQUMvQ0EsQ0FBQ0E7SUFDSEEsQ0FBQ0E7SUFFREEsTUFBTUEsQ0FBQ0EsY0FBY0EsQ0FBQ0EsTUFBTUEsRUFBRUEsU0FBU0EsQ0FBQ0EsQ0FBQ0E7QUFDM0NBLENBQUNBO0FBRUQsSUFBSSxZQUFZLEdBQUcsWUFBWSxDQUFDO0FBRWhDLHlCQUF5QixXQUFtQjtJQUMxQ0MsSUFBSUEsS0FBS0EsR0FBR0EsYUFBYUEsQ0FBQ0EsVUFBVUEsQ0FBQ0EsWUFBWUEsRUFBRUEsV0FBV0EsQ0FBQ0EsQ0FBQ0E7SUFDaEVBLE1BQU1BLENBQUNBLE9BQU9BLENBQUNBLEtBQUtBLENBQUNBLEdBQUdBLElBQUlBLEdBQUdBLEtBQUtBLENBQUNBLENBQUNBLENBQUNBLENBQUNBO0FBQzFDQSxDQUFDQSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIGlzUHJlc2VudCxcbiAgaXNCbGFuayxcbiAgU3RyaW5nV3JhcHBlcixcbiAgc3RyaW5naWZ5LFxuICBhc3NlcnRpb25zRW5hYmxlZCxcbiAgU3RyaW5nSm9pbmVyLFxuICBSZWdFeHBXcmFwcGVyLFxuICBzZXJpYWxpemVFbnVtLFxuICBDT05TVF9FWFBSXG59IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvbGFuZyc7XG5cbmltcG9ydCB7TGlzdFdyYXBwZXJ9IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvY29sbGVjdGlvbic7XG5cbmltcG9ydCB7SHRtbEFzdCwgSHRtbEF0dHJBc3QsIEh0bWxUZXh0QXN0LCBIdG1sRWxlbWVudEFzdH0gZnJvbSAnLi9odG1sX2FzdCc7XG5cbmltcG9ydCB7SW5qZWN0YWJsZX0gZnJvbSAnYW5ndWxhcjIvc3JjL2NvcmUvZGknO1xuaW1wb3J0IHtIdG1sVG9rZW4sIEh0bWxUb2tlblR5cGUsIHRva2VuaXplSHRtbH0gZnJvbSAnLi9odG1sX2xleGVyJztcbmltcG9ydCB7UGFyc2VFcnJvciwgUGFyc2VMb2NhdGlvbiwgUGFyc2VTb3VyY2VTcGFufSBmcm9tICcuL3BhcnNlX3V0aWwnO1xuaW1wb3J0IHtIdG1sVGFnRGVmaW5pdGlvbiwgZ2V0SHRtbFRhZ0RlZmluaXRpb259IGZyb20gJy4vaHRtbF90YWdzJztcblxuZXhwb3J0IGNsYXNzIEh0bWxUcmVlRXJyb3IgZXh0ZW5kcyBQYXJzZUVycm9yIHtcbiAgc3RhdGljIGNyZWF0ZShlbGVtZW50TmFtZTogc3RyaW5nLCBsb2NhdGlvbjogUGFyc2VMb2NhdGlvbiwgbXNnOiBzdHJpbmcpOiBIdG1sVHJlZUVycm9yIHtcbiAgICByZXR1cm4gbmV3IEh0bWxUcmVlRXJyb3IoZWxlbWVudE5hbWUsIGxvY2F0aW9uLCBtc2cpO1xuICB9XG5cbiAgY29uc3RydWN0b3IocHVibGljIGVsZW1lbnROYW1lOiBzdHJpbmcsIGxvY2F0aW9uOiBQYXJzZUxvY2F0aW9uLCBtc2c6IHN0cmluZykge1xuICAgIHN1cGVyKGxvY2F0aW9uLCBtc2cpO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBIdG1sUGFyc2VUcmVlUmVzdWx0IHtcbiAgY29uc3RydWN0b3IocHVibGljIHJvb3ROb2RlczogSHRtbEFzdFtdLCBwdWJsaWMgZXJyb3JzOiBQYXJzZUVycm9yW10pIHt9XG59XG5cbkBJbmplY3RhYmxlKClcbmV4cG9ydCBjbGFzcyBIdG1sUGFyc2VyIHtcbiAgcGFyc2Uoc291cmNlQ29udGVudDogc3RyaW5nLCBzb3VyY2VVcmw6IHN0cmluZyk6IEh0bWxQYXJzZVRyZWVSZXN1bHQge1xuICAgIHZhciB0b2tlbnNBbmRFcnJvcnMgPSB0b2tlbml6ZUh0bWwoc291cmNlQ29udGVudCwgc291cmNlVXJsKTtcbiAgICB2YXIgdHJlZUFuZEVycm9ycyA9IG5ldyBUcmVlQnVpbGRlcih0b2tlbnNBbmRFcnJvcnMudG9rZW5zKS5idWlsZCgpO1xuICAgIHJldHVybiBuZXcgSHRtbFBhcnNlVHJlZVJlc3VsdCh0cmVlQW5kRXJyb3JzLnJvb3ROb2RlcywgKDxQYXJzZUVycm9yW10+dG9rZW5zQW5kRXJyb3JzLmVycm9ycylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuY29uY2F0KHRyZWVBbmRFcnJvcnMuZXJyb3JzKSk7XG4gIH1cbn1cblxuY2xhc3MgVHJlZUJ1aWxkZXIge1xuICBwcml2YXRlIGluZGV4OiBudW1iZXIgPSAtMTtcbiAgcHJpdmF0ZSBwZWVrOiBIdG1sVG9rZW47XG5cbiAgcHJpdmF0ZSByb290Tm9kZXM6IEh0bWxBc3RbXSA9IFtdO1xuICBwcml2YXRlIGVycm9yczogSHRtbFRyZWVFcnJvcltdID0gW107XG5cbiAgcHJpdmF0ZSBlbGVtZW50U3RhY2s6IEh0bWxFbGVtZW50QXN0W10gPSBbXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHRva2VuczogSHRtbFRva2VuW10pIHsgdGhpcy5fYWR2YW5jZSgpOyB9XG5cbiAgYnVpbGQoKTogSHRtbFBhcnNlVHJlZVJlc3VsdCB7XG4gICAgd2hpbGUgKHRoaXMucGVlay50eXBlICE9PSBIdG1sVG9rZW5UeXBlLkVPRikge1xuICAgICAgaWYgKHRoaXMucGVlay50eXBlID09PSBIdG1sVG9rZW5UeXBlLlRBR19PUEVOX1NUQVJUKSB7XG4gICAgICAgIHRoaXMuX2NvbnN1bWVTdGFydFRhZyh0aGlzLl9hZHZhbmNlKCkpO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5UQUdfQ0xPU0UpIHtcbiAgICAgICAgdGhpcy5fY29uc3VtZUVuZFRhZyh0aGlzLl9hZHZhbmNlKCkpO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5DREFUQV9TVEFSVCkge1xuICAgICAgICB0aGlzLl9jbG9zZVZvaWRFbGVtZW50KCk7XG4gICAgICAgIHRoaXMuX2NvbnN1bWVDZGF0YSh0aGlzLl9hZHZhbmNlKCkpO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5DT01NRU5UX1NUQVJUKSB7XG4gICAgICAgIHRoaXMuX2Nsb3NlVm9pZEVsZW1lbnQoKTtcbiAgICAgICAgdGhpcy5fY29uc3VtZUNvbW1lbnQodGhpcy5fYWR2YW5jZSgpKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5wZWVrLnR5cGUgPT09IEh0bWxUb2tlblR5cGUuVEVYVCB8fFxuICAgICAgICAgICAgICAgICB0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5SQVdfVEVYVCB8fFxuICAgICAgICAgICAgICAgICB0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5FU0NBUEFCTEVfUkFXX1RFWFQpIHtcbiAgICAgICAgdGhpcy5fY2xvc2VWb2lkRWxlbWVudCgpO1xuICAgICAgICB0aGlzLl9jb25zdW1lVGV4dCh0aGlzLl9hZHZhbmNlKCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2tpcCBhbGwgb3RoZXIgdG9rZW5zLi4uXG4gICAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG5ldyBIdG1sUGFyc2VUcmVlUmVzdWx0KHRoaXMucm9vdE5vZGVzLCB0aGlzLmVycm9ycyk7XG4gIH1cblxuICBwcml2YXRlIF9hZHZhbmNlKCk6IEh0bWxUb2tlbiB7XG4gICAgdmFyIHByZXYgPSB0aGlzLnBlZWs7XG4gICAgaWYgKHRoaXMuaW5kZXggPCB0aGlzLnRva2Vucy5sZW5ndGggLSAxKSB7XG4gICAgICAvLyBOb3RlOiB0aGVyZSBpcyBhbHdheXMgYW4gRU9GIHRva2VuIGF0IHRoZSBlbmRcbiAgICAgIHRoaXMuaW5kZXgrKztcbiAgICB9XG4gICAgdGhpcy5wZWVrID0gdGhpcy50b2tlbnNbdGhpcy5pbmRleF07XG4gICAgcmV0dXJuIHByZXY7XG4gIH1cblxuICBwcml2YXRlIF9hZHZhbmNlSWYodHlwZTogSHRtbFRva2VuVHlwZSk6IEh0bWxUb2tlbiB7XG4gICAgaWYgKHRoaXMucGVlay50eXBlID09PSB0eXBlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fYWR2YW5jZSgpO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgX2NvbnN1bWVDZGF0YShzdGFydFRva2VuOiBIdG1sVG9rZW4pIHtcbiAgICB0aGlzLl9jb25zdW1lVGV4dCh0aGlzLl9hZHZhbmNlKCkpO1xuICAgIHRoaXMuX2FkdmFuY2VJZihIdG1sVG9rZW5UeXBlLkNEQVRBX0VORCk7XG4gIH1cblxuICBwcml2YXRlIF9jb25zdW1lQ29tbWVudChzdGFydFRva2VuOiBIdG1sVG9rZW4pIHtcbiAgICB0aGlzLl9hZHZhbmNlSWYoSHRtbFRva2VuVHlwZS5SQVdfVEVYVCk7XG4gICAgdGhpcy5fYWR2YW5jZUlmKEh0bWxUb2tlblR5cGUuQ09NTUVOVF9FTkQpO1xuICB9XG5cbiAgcHJpdmF0ZSBfY29uc3VtZVRleHQodG9rZW46IEh0bWxUb2tlbikge1xuICAgIHRoaXMuX2FkZFRvUGFyZW50KG5ldyBIdG1sVGV4dEFzdCh0b2tlbi5wYXJ0c1swXSwgdG9rZW4uc291cmNlU3BhbikpO1xuICB9XG5cbiAgcHJpdmF0ZSBfY2xvc2VWb2lkRWxlbWVudCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5lbGVtZW50U3RhY2subGVuZ3RoID4gMCkge1xuICAgICAgbGV0IGVsID0gTGlzdFdyYXBwZXIubGFzdCh0aGlzLmVsZW1lbnRTdGFjayk7XG5cbiAgICAgIGlmIChnZXRIdG1sVGFnRGVmaW5pdGlvbihlbC5uYW1lKS5pc1ZvaWQpIHtcbiAgICAgICAgdGhpcy5lbGVtZW50U3RhY2sucG9wKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfY29uc3VtZVN0YXJ0VGFnKHN0YXJ0VGFnVG9rZW46IEh0bWxUb2tlbikge1xuICAgIHZhciBwcmVmaXggPSBzdGFydFRhZ1Rva2VuLnBhcnRzWzBdO1xuICAgIHZhciBuYW1lID0gc3RhcnRUYWdUb2tlbi5wYXJ0c1sxXTtcbiAgICB2YXIgYXR0cnMgPSBbXTtcbiAgICB3aGlsZSAodGhpcy5wZWVrLnR5cGUgPT09IEh0bWxUb2tlblR5cGUuQVRUUl9OQU1FKSB7XG4gICAgICBhdHRycy5wdXNoKHRoaXMuX2NvbnN1bWVBdHRyKHRoaXMuX2FkdmFuY2UoKSkpO1xuICAgIH1cbiAgICB2YXIgZnVsbE5hbWUgPSBnZXRFbGVtZW50RnVsbE5hbWUocHJlZml4LCBuYW1lLCB0aGlzLl9nZXRQYXJlbnRFbGVtZW50KCkpO1xuICAgIHZhciBzZWxmQ2xvc2luZyA9IGZhbHNlO1xuICAgIC8vIE5vdGU6IFRoZXJlIGNvdWxkIGhhdmUgYmVlbiBhIHRva2VuaXplciBlcnJvclxuICAgIC8vIHNvIHRoYXQgd2UgZG9uJ3QgZ2V0IGEgdG9rZW4gZm9yIHRoZSBlbmQgdGFnLi4uXG4gICAgaWYgKHRoaXMucGVlay50eXBlID09PSBIdG1sVG9rZW5UeXBlLlRBR19PUEVOX0VORF9WT0lEKSB7XG4gICAgICB0aGlzLl9hZHZhbmNlKCk7XG4gICAgICBzZWxmQ2xvc2luZyA9IHRydWU7XG4gICAgICBpZiAobmFtZXNwYWNlUHJlZml4KGZ1bGxOYW1lKSA9PSBudWxsICYmICFnZXRIdG1sVGFnRGVmaW5pdGlvbihmdWxsTmFtZSkuaXNWb2lkKSB7XG4gICAgICAgIHRoaXMuZXJyb3JzLnB1c2goSHRtbFRyZWVFcnJvci5jcmVhdGUoXG4gICAgICAgICAgICBmdWxsTmFtZSwgc3RhcnRUYWdUb2tlbi5zb3VyY2VTcGFuLnN0YXJ0LFxuICAgICAgICAgICAgYE9ubHkgdm9pZCBhbmQgZm9yZWlnbiBlbGVtZW50cyBjYW4gYmUgc2VsZiBjbG9zZWQgXCIke3N0YXJ0VGFnVG9rZW4ucGFydHNbMV19XCJgKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLnBlZWsudHlwZSA9PT0gSHRtbFRva2VuVHlwZS5UQUdfT1BFTl9FTkQpIHtcbiAgICAgIHRoaXMuX2FkdmFuY2UoKTtcbiAgICAgIHNlbGZDbG9zaW5nID0gZmFsc2U7XG4gICAgfVxuICAgIHZhciBlbmQgPSB0aGlzLnBlZWsuc291cmNlU3Bhbi5zdGFydDtcbiAgICB2YXIgZWwgPSBuZXcgSHRtbEVsZW1lbnRBc3QoZnVsbE5hbWUsIGF0dHJzLCBbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IFBhcnNlU291cmNlU3BhbihzdGFydFRhZ1Rva2VuLnNvdXJjZVNwYW4uc3RhcnQsIGVuZCkpO1xuICAgIHRoaXMuX3B1c2hFbGVtZW50KGVsKTtcbiAgICBpZiAoc2VsZkNsb3NpbmcpIHtcbiAgICAgIHRoaXMuX3BvcEVsZW1lbnQoZnVsbE5hbWUpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3B1c2hFbGVtZW50KGVsOiBIdG1sRWxlbWVudEFzdCkge1xuICAgIGlmICh0aGlzLmVsZW1lbnRTdGFjay5sZW5ndGggPiAwKSB7XG4gICAgICB2YXIgcGFyZW50RWwgPSBMaXN0V3JhcHBlci5sYXN0KHRoaXMuZWxlbWVudFN0YWNrKTtcbiAgICAgIGlmIChnZXRIdG1sVGFnRGVmaW5pdGlvbihwYXJlbnRFbC5uYW1lKS5pc0Nsb3NlZEJ5Q2hpbGQoZWwubmFtZSkpIHtcbiAgICAgICAgdGhpcy5lbGVtZW50U3RhY2sucG9wKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHRhZ0RlZiA9IGdldEh0bWxUYWdEZWZpbml0aW9uKGVsLm5hbWUpO1xuICAgIHZhciBwYXJlbnRFbCA9IHRoaXMuX2dldFBhcmVudEVsZW1lbnQoKTtcbiAgICBpZiAodGFnRGVmLnJlcXVpcmVFeHRyYVBhcmVudChpc1ByZXNlbnQocGFyZW50RWwpID8gcGFyZW50RWwubmFtZSA6IG51bGwpKSB7XG4gICAgICB2YXIgbmV3UGFyZW50ID0gbmV3IEh0bWxFbGVtZW50QXN0KHRhZ0RlZi5wYXJlbnRUb0FkZCwgW10sIFtlbF0sIGVsLnNvdXJjZVNwYW4pO1xuICAgICAgdGhpcy5fYWRkVG9QYXJlbnQobmV3UGFyZW50KTtcbiAgICAgIHRoaXMuZWxlbWVudFN0YWNrLnB1c2gobmV3UGFyZW50KTtcbiAgICAgIHRoaXMuZWxlbWVudFN0YWNrLnB1c2goZWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9hZGRUb1BhcmVudChlbCk7XG4gICAgICB0aGlzLmVsZW1lbnRTdGFjay5wdXNoKGVsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9jb25zdW1lRW5kVGFnKGVuZFRhZ1Rva2VuOiBIdG1sVG9rZW4pIHtcbiAgICB2YXIgZnVsbE5hbWUgPVxuICAgICAgICBnZXRFbGVtZW50RnVsbE5hbWUoZW5kVGFnVG9rZW4ucGFydHNbMF0sIGVuZFRhZ1Rva2VuLnBhcnRzWzFdLCB0aGlzLl9nZXRQYXJlbnRFbGVtZW50KCkpO1xuXG4gICAgaWYgKGdldEh0bWxUYWdEZWZpbml0aW9uKGZ1bGxOYW1lKS5pc1ZvaWQpIHtcbiAgICAgIHRoaXMuZXJyb3JzLnB1c2goXG4gICAgICAgICAgSHRtbFRyZWVFcnJvci5jcmVhdGUoZnVsbE5hbWUsIGVuZFRhZ1Rva2VuLnNvdXJjZVNwYW4uc3RhcnQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYFZvaWQgZWxlbWVudHMgZG8gbm90IGhhdmUgZW5kIHRhZ3MgXCIke2VuZFRhZ1Rva2VuLnBhcnRzWzFdfVwiYCkpO1xuICAgIH0gZWxzZSBpZiAoIXRoaXMuX3BvcEVsZW1lbnQoZnVsbE5hbWUpKSB7XG4gICAgICB0aGlzLmVycm9ycy5wdXNoKEh0bWxUcmVlRXJyb3IuY3JlYXRlKGZ1bGxOYW1lLCBlbmRUYWdUb2tlbi5zb3VyY2VTcGFuLnN0YXJ0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgVW5leHBlY3RlZCBjbG9zaW5nIHRhZyBcIiR7ZW5kVGFnVG9rZW4ucGFydHNbMV19XCJgKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfcG9wRWxlbWVudChmdWxsTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgZm9yIChsZXQgc3RhY2tJbmRleCA9IHRoaXMuZWxlbWVudFN0YWNrLmxlbmd0aCAtIDE7IHN0YWNrSW5kZXggPj0gMDsgc3RhY2tJbmRleC0tKSB7XG4gICAgICBsZXQgZWwgPSB0aGlzLmVsZW1lbnRTdGFja1tzdGFja0luZGV4XTtcbiAgICAgIGlmIChlbC5uYW1lLnRvTG93ZXJDYXNlKCkgPT0gZnVsbE5hbWUudG9Mb3dlckNhc2UoKSkge1xuICAgICAgICBMaXN0V3JhcHBlci5zcGxpY2UodGhpcy5lbGVtZW50U3RhY2ssIHN0YWNrSW5kZXgsIHRoaXMuZWxlbWVudFN0YWNrLmxlbmd0aCAtIHN0YWNrSW5kZXgpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFnZXRIdG1sVGFnRGVmaW5pdGlvbihlbC5uYW1lKS5jbG9zZWRCeVBhcmVudCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgX2NvbnN1bWVBdHRyKGF0dHJOYW1lOiBIdG1sVG9rZW4pOiBIdG1sQXR0ckFzdCB7XG4gICAgdmFyIGZ1bGxOYW1lID0gbWVyZ2VOc0FuZE5hbWUoYXR0ck5hbWUucGFydHNbMF0sIGF0dHJOYW1lLnBhcnRzWzFdKTtcbiAgICB2YXIgZW5kID0gYXR0ck5hbWUuc291cmNlU3Bhbi5lbmQ7XG4gICAgdmFyIHZhbHVlID0gJyc7XG4gICAgaWYgKHRoaXMucGVlay50eXBlID09PSBIdG1sVG9rZW5UeXBlLkFUVFJfVkFMVUUpIHtcbiAgICAgIHZhciB2YWx1ZVRva2VuID0gdGhpcy5fYWR2YW5jZSgpO1xuICAgICAgdmFsdWUgPSB2YWx1ZVRva2VuLnBhcnRzWzBdO1xuICAgICAgZW5kID0gdmFsdWVUb2tlbi5zb3VyY2VTcGFuLmVuZDtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBIdG1sQXR0ckFzdChmdWxsTmFtZSwgdmFsdWUsIG5ldyBQYXJzZVNvdXJjZVNwYW4oYXR0ck5hbWUuc291cmNlU3Bhbi5zdGFydCwgZW5kKSk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRQYXJlbnRFbGVtZW50KCk6IEh0bWxFbGVtZW50QXN0IHtcbiAgICByZXR1cm4gdGhpcy5lbGVtZW50U3RhY2subGVuZ3RoID4gMCA/IExpc3RXcmFwcGVyLmxhc3QodGhpcy5lbGVtZW50U3RhY2spIDogbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgX2FkZFRvUGFyZW50KG5vZGU6IEh0bWxBc3QpIHtcbiAgICB2YXIgcGFyZW50ID0gdGhpcy5fZ2V0UGFyZW50RWxlbWVudCgpO1xuICAgIGlmIChpc1ByZXNlbnQocGFyZW50KSkge1xuICAgICAgcGFyZW50LmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucm9vdE5vZGVzLnB1c2gobm9kZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG1lcmdlTnNBbmROYW1lKHByZWZpeDogc3RyaW5nLCBsb2NhbE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBpc1ByZXNlbnQocHJlZml4KSA/IGBAJHtwcmVmaXh9OiR7bG9jYWxOYW1lfWAgOiBsb2NhbE5hbWU7XG59XG5cbmZ1bmN0aW9uIGdldEVsZW1lbnRGdWxsTmFtZShwcmVmaXg6IHN0cmluZywgbG9jYWxOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50RWxlbWVudDogSHRtbEVsZW1lbnRBc3QpOiBzdHJpbmcge1xuICBpZiAoaXNCbGFuayhwcmVmaXgpKSB7XG4gICAgcHJlZml4ID0gZ2V0SHRtbFRhZ0RlZmluaXRpb24obG9jYWxOYW1lKS5pbXBsaWNpdE5hbWVzcGFjZVByZWZpeDtcbiAgICBpZiAoaXNCbGFuayhwcmVmaXgpICYmIGlzUHJlc2VudChwYXJlbnRFbGVtZW50KSkge1xuICAgICAgcHJlZml4ID0gbmFtZXNwYWNlUHJlZml4KHBhcmVudEVsZW1lbnQubmFtZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1lcmdlTnNBbmROYW1lKHByZWZpeCwgbG9jYWxOYW1lKTtcbn1cblxudmFyIE5TX1BSRUZJWF9SRSA9IC9eQChbXjpdKykvZztcblxuZnVuY3Rpb24gbmFtZXNwYWNlUHJlZml4KGVsZW1lbnROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICB2YXIgbWF0Y2ggPSBSZWdFeHBXcmFwcGVyLmZpcnN0TWF0Y2goTlNfUFJFRklYX1JFLCBlbGVtZW50TmFtZSk7XG4gIHJldHVybiBpc0JsYW5rKG1hdGNoKSA/IG51bGwgOiBtYXRjaFsxXTtcbn1cbiJdfQ==