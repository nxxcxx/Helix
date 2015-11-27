(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('api', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('api', 'searchById => DB:', res.data);
			if (res.data) {
				movieIdCache.put(res.data.id, res.data);
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('api', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('api', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http.get(TMDB_API.url + 'search/movie', {
			cache: true,
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			log.debug('api', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					log.debug('api', item.id, item);
					movieIdCache.put(item.id, item);
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', 'searchByTitle:', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

		var identity = null;
		var _identityResolved = false;

		function authorize(force) {

				var deferred = $q.defer();

				if (force) identity = null;

				if (identity !== null) {

						deferred.resolve(true);
				} else {

						$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

								log.debug('auth', 'auth.authorize():', res, res.data);
								identity = res.data;
								_identityResolved = true;
								deferred.resolve(true);
						}, function (err) {

								log.debug('err', 'authorize', err, err.data);
								// todo if jwt expired , deauthorize, remove local storage, redirect
								_identityResolved = true;
								deferred.reject(err);
						});
				}

				return deferred.promise;
		}

		function deauthorize() {
				authToken.removeToken();
				identity = null;
		}

		function isAuthenticated() {
				return identity !== null;
		}

		function identityResolved() {
				return _identityResolved;
		}

		return {

				authorize: authorize,
				deauthorize: deauthorize,
				isAuthenticated: isAuthenticated,
				identityResolved: identityResolved

		};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		if (config.requireAuth) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['log', '$window', function (log, $window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		log.debug('auth', 'token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('auth', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('auth', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('err', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

					var vm = this;
					vm.user = {};

					vm.signup = function () {

										if (vm.user.email === undefined || vm.user.password === undefined) {
															log.debug('warn', 'email & password required.');
															return;
										}

										log.debug('auth', 'signing up...');
										$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

															log.debug('auth', 'Registered.', res);

															authToken.setToken(res.data.token);
															$state.go('collection');
										}, function (err) {

															log.debug('err', err);
															vm.form.$submitted = false;
										});
					};
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		},
		helixNeedsReset: {
			listen: function listen(cb) {
				$rootScope.$on('helixNeedsReset', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('helixNeedsReset');
			}
		}

	};

	return EVT;
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, [debugName].concat(slicedArgs));
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace('info', 'err');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	});
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = [function () {

	function link($scope, $element, $attrs) {

		$element.on('mouseenter', function () {
			$element.removeClass($attrs.leave);
			$element.addClass($attrs.hover);
		}).on('mouseleave', function () {
			$element.removeClass($attrs.hover);
			$element.addClass($attrs.leave);
		});
	}

	return {
		restrict: 'A',
		link: link
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],16:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $(window).width();
		$$.height = $(window).height();
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],18:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js
		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],19:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).directive('hoverClass', require('./directive/hoverClass.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./directive/hoverClass.dir.js":14,"./helix/display.dir.js":15,"./helix/engine.fac.js":16,"./helix/helix.fac.js":17,"./helix/poster.dir.js":18,"./main.ctrl.js":20,"./movieCollection/collectionItem.dir.js":21,"./movieCollection/collectionModal.dir.js":22,"./movieCollection/collectionModalService.fac.js":23,"./movieCollection/movieCollection.ctrl.js":24,"./movieCollection/movieCollection.fac.js":25,"./movieDetail.ctrl.js":26}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', '$rootScope', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state, $rootScope) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems, oldMovItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(oldMovItems.length), oldMovItems.length);
	}, true);

	var prevQuery = '';
	var helixNeedsReset = false;
	EVT.helixNeedsReset.listen(function () {
		helixNeedsReset = true;
	});

	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query || helixNeedsReset) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
			helixNeedsReset = false;
		}
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w92/' + res.poster_path;
			$element.css({
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],22:[function(require,module,exports){
'use strict';

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

	function ctrl($scope, $element, $attrs) {

		var vm = this;
		vm.movieCollection = movieCollection;
		vm.collectionModalService = collectionModalService;

		vm.addingNewCollection = false;

		vm.openEditor = function () {
			vm.addingNewCollection = true;
		};

		vm.closeEditor = function () {
			vm.addingNewCollection = false;
		};

		vm.createNewCollection = function () {
			if ($scope.newCollectionName) {
				movieCollection.create($scope.newCollectionName);
				$scope.newCollectionName = '';
				vm.closeEditor();
			}
		};

		vm.addToCollection = function (movieId, collectionName) {
			log.debug('collection', 'addToCollection:', movieId, collectionName);
			var success = movieCollection.push(movieId, collectionName);
			log.debug('collection', 'movieCollection.push', success);
		};

		vm.closeModal = function () {
			vm.addingNewCollection = false;
			$scope.newCollectionName = '';
			collectionModalService.close();
		};

		// default css at directive initialization
		$element.css({ visibility: 'hidden' });

		EVT.collectionModalOpen.listen(function () {
			log.debug('collection', 'collectionModalOpen');
			$element.css({ visibility: 'visible' });
		});

		EVT.collectionModalClose.listen(function () {
			log.debug('collection', 'collectionModalClose');
			$element.css({ visibility: 'hidden' });
		});
	}

	return {

		restrict: 'E',
		scope: {},
		controller: ctrl,
		controllerAs: 'modal',
		replace: true,
		templateUrl: './template/collectionModal.html'

	};
}];

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', 'auth', '$state', function (log, EVT, auth, $state) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		if (auth.isAuthenticated()) {
			EVT.collectionModalOpen.emit();
		} else {
			$state.go('signin');
		}
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', 'TMDb', 'helix', 'ENGINE', '$state', 'EVT', function (log, $scope, auth, movieCollection, TMDb, helix, ENGINE, $state, EVT) {

	log.debug('collection', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function (collection) {

		log.debug('info', 'viewCollection =>', collection);

		var loadedItems = 0;
		var totalItems = collection.movies.length;
		var allMovies = [];

		collection.movies.forEach(function (movieId) {

			TMDb.searchById(movieId).then(function (res) {
				allMovies.push(res);
			}, function (err) {
				log.debug('err', 'viewCollection =>', err);
			})['finally'](function () {
				if (++loadedItems === totalItems) {

					helix.clearAll();
					ENGINE.resetCamera();
					helix.makeHelixPosters(allMovies, 0);
					$state.go('helix');
					TMDb.clearSearch();
					EVT.helixNeedsReset.emit();
				}
			});
		});
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('collection', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('err', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('collection', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	function push(itemId, toCollection) {
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
				put();
				return removed !== 0;
			}
		}
		return false;
	}

	function sync() {
		// sync local colelction w/ DB
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug('collection', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],26:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', 'movieCollection', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService, movieCollection) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}]},{},[19])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL0FQSS9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvYXV0aC9hdXRoLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9hdXRoL3NpZ251cC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb21tb24vZXZlbnRzLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvY29tbW9uL3V0aWwuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2NvbmZpZy9odHRwQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb25maWcvcm91dGVDb25maWcuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2RpcmVjdGl2ZS9ob3ZlckNsYXNzLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2hlbGl4L2VuZ2luZS5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2hlbGl4L2hlbGl4LmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaW5kZXguanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL21haW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7O0FDQUEsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFDM0YsVUFBVyxHQUFHLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUc7O0FBRXZFLEtBQUksWUFBWSxHQUFHLEVBQUUsQ0FBQztBQUN0QixLQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNwQixLQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7O0FBRWpCLEtBQUksWUFBWSxHQUFHLGFBQWEsQ0FBRSxjQUFjLENBQUUsQ0FBQzs7O0FBR25ELEtBQUksV0FBVyxHQUFHLFlBQVksR0FBRyxRQUFRLENBQUM7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QUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxzQkFBc0IsRUFBRSxlQUFlLEVBQUc7O0FBRWhHLEtBQUksRUFBRSxHQUFHLElBQUksQ0FBQztBQUNkLEdBQUUsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0FBQ3pCLElBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLDRCQUE0QixFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUUsQ0FBQzs7QUFFaEUsVUFBUyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDO0FBQ3RDLEtBQUssU0FBUyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsY0FBYyxFQUFHO0FBQ25ELFdBQVMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFJLEdBQUcsU0FBUyxDQUFDLGNBQWMsR0FBRyxHQUFHLENBQUM7RUFDOUU7O0FBRUQsS0FBSyxTQUFTLENBQUMsYUFBYSxFQUFHO0FBQzlCLE1BQUksTUFBTSxHQUFHLG9DQUFvQyxHQUFHLFNBQVMsQ0FBQyxhQUFhLENBQUM7QUFDNUUsR0FBQyxDQUFFLFdBQVcsQ0FBRSxDQUFDLEdBQUcsQ0FBRTtBQUNyQixxQkFBa0IsRUFBRSxNQUFNLEdBQUcsTUFBTSxHQUFHLEdBQUc7R0FDekMsQ0FBRSxDQUFDO0VBQ0o7O0FBRUQsR0FBRSxDQUFDLG1CQUFtQixHQUFHLFlBQVk7QUFDcEMsd0JBQXNCLENBQUMsYUFBYSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0FBQ2xELHdCQUFzQixDQUFDLElBQUksRUFBRSxDQUFDO0VBQzlCLENBQUM7Q0FFRixDQUFFLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJGh0dHAnLCAnVE1EQl9BUEknLCAnRVZUJywgJyRjYWNoZUZhY3RvcnknLCAnJHEnLCAnRU5EUE9JTlRfVVJJJyxcclxuZnVuY3Rpb24gKCBsb2csICRodHRwLCBUTURCX0FQSSwgRVZULCAkY2FjaGVGYWN0b3J5LCAkcSwgRU5EUE9JTlRfVVJJICkge1xyXG5cclxuXHR2YXIgc2VhcmNoUmVzdWx0ID0gW107XHJcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcclxuXHR2YXIgY3VyclBhZ2UgPSAxO1xyXG5cclxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcclxuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xyXG5cclxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xyXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCArIG1vdmllSXRlbS5pZCwgbW92aWVJdGVtIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ1BVVDonLCByZXMgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnUFVUOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIERCX0VORFBPSU5UICsgaWQgKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xyXG5cdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24oIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0XHRyZXR1cm4gcHJvbWlzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbUFQSSggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ21vdmllLycgKyBpZCwge1xyXG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cclxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xyXG5cdFx0XHRwdXRJdGVtVG9EQiggcmVzLmRhdGEgKTtcclxuXHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IEFQSTonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XHJcblxyXG5cdFx0dmFyIGRmX0RCID0gJHEuZGVmZXIoKTtcclxuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdHZhciBjYWNoZWRJdGVtID0gbW92aWVJZENhY2hlLmdldCggaWQgKTtcclxuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5SWQgPT4gY2FjaGU6JywgY2FjaGVkSXRlbSApO1xyXG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggY2FjaGVkSXRlbSApO1xyXG5cdFx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblx0XHR9XHJcblxyXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGlmICggcmVzICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlc29sdmUoIHJlcyApO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggJ25vdCBmb3VuZCcgKTtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRkZl9EQi5wcm9taXNlLnRoZW4oIGZ1bmN0aW9uICggcmVzX0RCICkge1xyXG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX0RCICk7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0c2VhcmNoSWRGcm9tQVBJKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX2FwaSApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlamVjdCggZXJyX2FwaSApO1xyXG5cdFx0XHR9ICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcclxuXHJcblx0XHRpZiAoIGN1cnJQYWdlID4gdG90YWxQYWdlcyAmJiB0b3RhbFBhZ2VzICE9PSAtMSApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxyXG5cdFx0XHRFVlQuRU9QLmVtaXQoKTtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cclxuXHRcdCRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ3NlYXJjaC9tb3ZpZScsIHtcclxuXHRcdFx0Y2FjaGU6IHRydWUsXHJcblx0XHRcdHBhcmFtczoge1xyXG5cdFx0XHRcdGFwaV9rZXk6IFRNREJfQVBJLmtleSxcclxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxyXG5cdFx0XHRcdHBhZ2U6IGN1cnJQYWdlXHJcblx0XHRcdH1cclxuXHRcdH0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBzdWNjZXNzXHJcblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xyXG5cdFx0XHR0b3RhbFBhZ2VzID0gcmVzLmRhdGEudG90YWxfcGFnZXM7XHJcblx0XHRcdGN1cnJQYWdlICsrO1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlUaXRsZTonLCByZXMsIHJlcy5kYXRhICk7XHJcblxyXG5cdFx0XHQvLyBjYWNoZVxyXG5cdFx0XHRyZXMuZGF0YS5yZXN1bHRzLmZvckVhY2goIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHJcblx0XHRcdFx0aWYgKCAhbW92aWVJZENhY2hlLmdldCggaXRlbS5pZCApICkge1xyXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgaXRlbS5pZCwgaXRlbSApO1xyXG5cdFx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggaXRlbS5pZCwgaXRlbSApO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeVRpdGxlOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XHJcblx0XHRyZXR1cm4gcmVzdWx0cy5maWx0ZXIoIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcclxuXHRcdHJldHVybiBzZWFyY2hSZXN1bHQ7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbGVhclNlYXJjaCgpIHtcclxuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxyXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XHJcblx0XHR0b3RhbFBhZ2VzID0gLTE7XHJcblx0XHRjdXJyUGFnZSA9IDE7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2VhcmNoQnlUaXRsZSxcclxuXHRcdHNlYXJjaEJ5SWQsXHJcblx0XHRjbGVhclNlYXJjaCxcclxuXHRcdGdldFJlcyxcclxuXHRcdHB1dEl0ZW1Ub0RCLFxyXG5cdFx0bW92aWVJZENhY2hlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgJ2F1dGhUb2tlbicsXHJcbmZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xyXG5cclxuXHRcdHZhciBpZGVudGl0eSA9IG51bGw7XHJcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcclxuXHJcblx0XHRmdW5jdGlvbiBhdXRob3JpemUoIGZvcmNlICkge1xyXG5cclxuXHRcdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XHJcblxyXG5cdFx0XHRpZiAoIGlkZW50aXR5ICE9PSBudWxsICkge1xyXG5cclxuXHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XHJcblxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cclxuXHRcdFx0XHQkaHR0cC5nZXQoIEVORFBPSU5UX1VSSSArICdhdXRoJywgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHJcblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnYXV0aC5hdXRob3JpemUoKTonLCByZXMsIHJlcy5kYXRhICk7XHJcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XHJcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcclxuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xyXG5cclxuXHRcdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cclxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2F1dGhvcml6ZScsIGVyciwgZXJyLmRhdGEgKTtcclxuXHRcdFx0XHRcdFx0Ly8gdG9kbyBpZiBqd3QgZXhwaXJlZCAsIGRlYXV0aG9yaXplLCByZW1vdmUgbG9jYWwgc3RvcmFnZSwgcmVkaXJlY3RcclxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xyXG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xyXG5cclxuXHRcdFx0XHRcdH0gKTtcclxuXHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xyXG5cclxuXHRcdH1cclxuXHJcblx0XHRmdW5jdGlvbiBkZWF1dGhvcml6ZSgpIHtcclxuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XHJcblx0XHRcdGlkZW50aXR5ID0gbnVsbDtcclxuXHRcdH1cclxuXHJcblx0XHRmdW5jdGlvbiBpc0F1dGhlbnRpY2F0ZWQoKSB7XHJcblx0XHRcdHJldHVybiBpZGVudGl0eSAhPT0gbnVsbDtcclxuXHRcdH1cclxuXHJcblx0XHRmdW5jdGlvbiBpZGVudGl0eVJlc29sdmVkKCkge1xyXG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHtcclxuXHJcblx0XHRcdGF1dGhvcml6ZSxcclxuXHRcdFx0ZGVhdXRob3JpemUsXHJcblx0XHRcdGlzQXV0aGVudGljYXRlZCxcclxuXHRcdFx0aWRlbnRpdHlSZXNvbHZlZFxyXG5cclxuXHRcdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XHJcblxyXG5cdGZ1bmN0aW9uIHJlcXVlc3QoIGNvbmZpZyApIHtcclxuXHJcblx0XHRpZiAoIGNvbmZpZy5yZXF1aXJlQXV0aCApIHtcclxuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XHJcblx0XHRcdGlmICggdG9rZW4gKSB7XHJcblx0XHRcdFx0Ly8gaHR0cDovL3NlbGYtaXNzdWVkLmluZm8vZG9jcy9kcmFmdC1pZXRmLW9hdXRoLXYyLWJlYXJlci5odG1sICAgc2VjdGlvbiAyLjFcclxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xyXG5cdFx0XHRcdC8vIGh0dHA6Ly93d3cudzMub3JnL1Byb3RvY29scy9yZmMyNjE2L3JmYzI2MTYtc2VjNC5odG1sIHNlY3Rpb24gNC4yIGhlYWRlciBmaWVsZCBuYW1lIGNhc2UgaW5zZW5zaXRpdmVcclxuXHRcdFx0XHRjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gY29uZmlnO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlc3BvbnNlKCByZXMgKSB7XHJcblx0XHRyZXR1cm4gcmVzO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHJcblx0XHRyZXF1ZXN0LFxyXG5cdFx0cmVzcG9uc2VcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xyXG5cclxuXHR2YXIgc3RvcmFnZSA9ICR3aW5kb3cubG9jYWxTdG9yYWdlO1xyXG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIHNldFRva2VuKCB0b2tlbiApIHtcclxuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XHJcblx0XHRzdG9yYWdlLnNldEl0ZW0oICdqd3QnLCB0b2tlbiApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0VG9rZW4oKSB7XHJcblx0XHRpZiAoICFjYWNoZWRUb2tlbiApIHtcclxuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gY2FjaGVkVG9rZW47XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVUb2tlbigpIHtcclxuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcclxuXHRcdHN0b3JhZ2UucmVtb3ZlSXRlbSggJ2p3dCcgKTtcclxuXHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAndG9rZW4gcmVtb3ZlZCcgKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGhhc1Rva2VuKCkge1xyXG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0c2V0VG9rZW4sXHJcblx0XHRnZXRUb2tlbixcclxuXHRcdHJlbW92ZVRva2VuLFxyXG5cdFx0aGFzVG9rZW5cclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSAge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLnVzZXIgPSB7XHJcblx0XHRlbWFpbDogJycsXHJcblx0XHRwYXNzd29yZDogJydcclxuXHR9O1xyXG5cclxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcclxuXHJcblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ25pbicsIHZtLnVzZXIgKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzaWduaW4nLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XHJcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSB7XHJcblxyXG5cdFx0dmFyIHZtID0gdGhpcztcclxuXHRcdHZtLnVzZXIgPSB7fTtcclxuXHJcblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09IHVuZGVmaW5lZCB8fCB2bS51c2VyLnBhc3N3b3JkID09PSB1bmRlZmluZWQgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcclxuXHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ1JlZ2lzdGVyZWQuJywgcmVzICk7XHJcblxyXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xyXG5cdFx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblxyXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgZXJyICk7XHJcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcclxuXHJcblx0XHRcdFx0fSApO1xyXG5cclxuXHRcdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cdFx0Y29sbGVjdGlvbk1vZGFsT3Blbjoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsT3BlbicsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTsgfVxyXG5cdFx0fSxcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbENsb3NlOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxDbG9zZScsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7IH1cclxuXHRcdH0sXHJcblx0XHRoZWxpeE5lZWRzUmVzZXQ6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2hlbGl4TmVlZHNSZXNldCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnaGVsaXhOZWVkc1Jlc2V0JyApOyB9XHJcblx0XHR9XHJcblxyXG5cdH07XHJcblxyXG5cdHJldHVybiBFVlQ7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcclxuXHR2YXIgZGVidWdOYW1lc3BhY2VzID0gW107XHJcblxyXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRkZWJ1Z0VuYWJsZWQgPSB0cnVlO1xyXG5cdH07XHJcblxyXG5cdHRoaXMuZW5hYmxlRGVidWdOYW1lc3BhY2UgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XHJcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xyXG5cdFx0fVxyXG5cdH07XHJcblxyXG5cdHRoaXMuJGdldCA9ICgpID0+IHtcclxuXHJcblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcclxuXHRcdFx0aWYgKCAhZGVidWdFbmFibGVkICkgcmV0dXJuO1xyXG5cdFx0XHR2YXIgZGVidWdOYW1lID0gYXJndW1lbnRzWyAwIF07XHJcblx0XHRcdHZhciBzbGljZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoIGFyZ3VtZW50cywgMSApO1xyXG5cdFx0XHRpZiAoIGRlYnVnTmFtZSA9PT0gJ2VycicgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5lcnJvci5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICdpbmZvJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmluZm8uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnd2FybicgKSB7XHJcblx0XHRcdFx0Y29uc29sZS53YXJuLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZXNwYWNlcy5pbmRleE9mKCBkZWJ1Z05hbWUgKSAhPT0gLTEgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5sb2cuYXBwbHkoIGNvbnNvbGUsIFsgZGVidWdOYW1lIF0uY29uY2F0KCBzbGljZWRBcmdzICkgKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiB7XHJcblx0XHRcdGRlYnVnXHJcblx0XHR9O1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xyXG5cdFx0dmFyIF90aGlzID0gdGhpcyxcclxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcclxuXHJcblx0XHR2YXIgdGltZW91dDtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxyXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xyXG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcclxuXHJcblx0XHRcdFx0dGltZW91dCA9IG51bGw7XHJcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcclxuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XHJcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xyXG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGRlYm91bmNlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCAkaHR0cFByb3ZpZGVyICkge1xyXG5cdCRodHRwUHJvdmlkZXIuaW50ZXJjZXB0b3JzLnB1c2goICdhdXRoSW50ZXJjZXB0b3InICk7XHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcclxuXHJcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcclxuXHQvLyBsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJywgJ2F1dGgnLCAnYXBpJywgJ2NvbGxlY3Rpb24nICk7XHJcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicgKTtcclxuXHJcblx0JGh0dHBQcm92aWRlci51c2VMZWdhY3lQcm9taXNlRXh0ZW5zaW9ucyggZmFsc2UgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGVQcm92aWRlcicsICckdXJsUm91dGVyUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsXHJcbmZ1bmN0aW9uICggJHN0YXRlUHJvdmlkZXIsICR1cmxSb3V0ZXJQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcclxuXHJcblx0JHVybFJvdXRlclByb3ZpZGVyLm90aGVyd2lzZSggJy8nICk7XHJcblxyXG5cdCRzdGF0ZVByb3ZpZGVyXHJcblx0XHQuc3RhdGUoICdoZWxpeCcsIHtcclxuXHRcdFx0dXJsOiAnLycsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9oZWxpeC5odG1sJ1xyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoICdzaWdudXAnLCB7XHJcblx0XHRcdHVybDogJy9zaWdudXAnLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbnVwLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbnVwQ3RybCcsXHJcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ251cCdcclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnc2lnbmluJywge1xyXG5cdFx0XHR1cmw6ICcvc2lnbmluJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ25pbi5odG1sJyxcclxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25pbkN0cmwnLFxyXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWduaW4nXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ3NpZ25vdXQnLCB7XHJcblx0XHRcdHVybDogJy9zaWdub3V0JyxcclxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25vdXRDdHJsJ1xyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcclxuXHRcdFx0dXJsOiAnL21vdmllLzptb3ZpZUlkJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL21vdmllRGV0YWlsLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWQnLFxyXG5cdFx0XHRyZXNvbHZlOiB7XHJcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xyXG5cdFx0XHRcdFx0cmV0dXJuIFRNRGIuc2VhcmNoQnlJZCggJHN0YXRlUGFyYW1zLm1vdmllSWQgKTtcclxuXHRcdFx0XHR9IF1cclxuXHRcdFx0fVxyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoJ2NvbGxlY3Rpb24nLCB7XHJcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb24uaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZUNvbGxlY3Rpb25DdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWMnLFxyXG5cdFx0XHRyZXNvbHZlOiB7XHJcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xyXG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XHJcblx0XHRcdFx0fSBdLFxyXG5cdFx0XHRcdHJlc29sdmVkQ29sbGVjdGlvbjogWyAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBtb3ZpZUNvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0XHRyZXR1cm4gbW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XHJcblx0XHRcdFx0fSBdXHJcblx0XHRcdH1cclxuXHRcdH0pXHJcblx0O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBsaW5rKCAkc2NvcGUsICRlbGVtZW50LCAkYXR0cnMgKSB7XHJcblxyXG5cdFx0JGVsZW1lbnRcclxuXHRcdC5vbiggJ21vdXNlZW50ZXInLCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdCRlbGVtZW50LnJlbW92ZUNsYXNzKCAkYXR0cnMubGVhdmUgKTtcclxuXHRcdFx0JGVsZW1lbnQuYWRkQ2xhc3MoICRhdHRycy5ob3ZlciApO1xyXG5cdFx0fSApXHJcblx0XHQub24oICdtb3VzZWxlYXZlJywgZnVuY3Rpb24gKCkge1xyXG5cdFx0XHQkZWxlbWVudC5yZW1vdmVDbGFzcyggJGF0dHJzLmhvdmVyICk7XHJcblx0XHRcdCRlbGVtZW50LmFkZENsYXNzKCAkYXR0cnMubGVhdmUgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0cmVzdHJpY3Q6ICdBJyxcclxuXHRcdGxpbms6IGxpbmtcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcclxuXHJcblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHRFTkdJTkUuYXR0YWNoUmVuZGVyZXIoICRlbGVtZW50ICk7XHJcblx0XHQkKCAkd2luZG93ICkub24oICdyZXNpemUnLCB1dGlsLmRlYm91bmNlKCBFTkdJTkUub25XaW5kb3dSZXNpemUsIDEwMCApICk7XHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XHJcblx0XHRcdEVOR0lORS4kJC53aGVlbF9keSA9IC1NYXRoLnNpZ24oIGV2dC5vcmlnaW5hbEV2ZW50LmRlbHRhWSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRyZXN0cmljdDogJ0UnLFxyXG5cdFx0cmVwbGFjZTogdHJ1ZSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsIGZ1bmN0aW9uICggJHdpbmRvdyApIHtcclxuXHJcblx0dmFyICQkID0ge1xyXG5cdFx0Y2FudmFzOiBudWxsLFxyXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxyXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxyXG5cdFx0d2lkdGg6ICQod2luZG93KS53aWR0aCgpLFxyXG5cdFx0aGVpZ2h0OiAkKHdpbmRvdykuaGVpZ2h0KCksXHJcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxyXG5cdFx0cmVuZGVyZXI6IG5ldyBUSFJFRS5DU1MzRFJlbmRlcmVyKCksXHJcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcclxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcclxuXHRcdG1vdXNlX3g6IHRoaXMud2lkdGggKiAwLjUsXHJcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcclxuXHRcdHdoZWVsX2R5OiAwXHJcblx0fTtcclxuXHJcblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xyXG5cclxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xyXG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xyXG5cdFx0Y2FudmFzLmFwcGVuZCggJCQucmVuZGVyZXIuZG9tRWxlbWVudCApO1xyXG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XHJcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xyXG5cdFx0JCQuaGVpZ2h0ID0gJCh3aW5kb3cpLmhlaWdodCgpO1xyXG5cdFx0JCQucGl4ZWxfcmF0aW8gPSAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcclxuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xyXG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcclxuXHRcdCQkLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XHJcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XHJcblxyXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xyXG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcclxuXHRcdFx0JCQuY2FtZXJhLnJvdGF0ZVkoICQkLndoZWVsX2R5ICogMC4wMjUgKTtcclxuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcclxuXHRcdH1cclxuXHJcblx0fVxyXG5cclxuXHQvLyAtLS0tICBkcmF3IGxvb3BcclxuXHRmdW5jdGlvbiBydW4oKSB7XHJcblxyXG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCBydW4gKTtcclxuXHRcdHVwZGF0ZSgpO1xyXG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XHJcblx0XHQkJC5zdGF0cy51cGRhdGUoKTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzdGFydCgpIHtcclxuXHRcdHNldHVwKCk7XHJcblx0XHRydW4oKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlc2V0Q2FtZXJhKCkge1xyXG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xyXG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdCQkLFxyXG5cdFx0YXR0YWNoUmVuZGVyZXIsXHJcblx0XHRvbldpbmRvd1Jlc2l6ZSxcclxuXHRcdHN0YXJ0LFxyXG5cdFx0cmVzZXRDYW1lcmEsXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcclxuXHRFTkdJTkUuJCQuc2NlbmUuYWRkKCBhbGxQb3N0ZXJzICk7XHJcblxyXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcclxuXHJcblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcclxuXHRcdHZhciByYWRpdXMgPSA5MDA7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBwb3N0ZXJPYmplY3RNdWx0aS5sZW5ndGg7IGkrKyApIHtcclxuXHJcblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xyXG5cdFx0XHQkaXNvbGF0ZWRTY29wZS5tb3ZpZUl0ZW0gPSBwb3N0ZXJPYmplY3RNdWx0aVsgaSBdO1xyXG5cclxuXHRcdFx0dmFyIHBvc3RlckRpcmVjdGl2ZUVsZW0gPSAkY29tcGlsZSggJzxwb3N0ZXI+PC9wb3N0ZXI+JyApKCAkaXNvbGF0ZWRTY29wZSApWyAwIF07XHJcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xyXG5cclxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XHJcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XHJcblxyXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcclxuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xyXG5cclxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcclxuXHJcblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XHJcblx0XHRcdGFsbFBvc3RlcnMuYWRkKCBjc3MzZE9iaiApO1xyXG5cclxuXHRcdH1cclxuXHJcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5mb3JFYWNoKCBmdW5jdGlvbiAoIHBvc3RlciApIHtcclxuXHRcdFx0cG9zdGVyLmRpc3Bvc2VFbGVtZW50KCk7XHJcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xyXG5cdFx0fSApO1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggPSAwOyAvLyBjbGVhciBpdGVtc1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXHJcblx0XHRjbGVhckFsbFxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCBmdW5jdGlvbiAoICRzdGF0ZSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcclxuXHJcblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHQvLyAkc2NvcGUubW92aWVJdGVtIG9iaiBpcyBwYXNzZWQgdGhydSBpc29sYXRlZFNjb3BlIHZpYSBjb21waWxlZCBkaXJlY3RpdmUgaW4gaGVsaXguZmFjLmpzXHJcblx0XHR2YXIgaW1nID0gbmV3IEltYWdlKCk7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzE1NC8nICsgJHNjb3BlLm1vdmllSXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHQvLyB0b2RvIG1vdmUgY3NzIGludG8gc2FzcywgdXNlIGNsYXNzIGluc3RlYWRcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzE1MHB4JyxcclxuXHRcdFx0XHQnaGVpZ2h0JzogJzIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzE1MHB4IDIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJyxcclxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxyXG5cdFx0XHR9ICk7XHJcblx0XHRcdCRlbGVtZW50LmZhZGVJbiggMTUwMCApO1xyXG5cclxuXHRcdH07XHJcblx0XHRpbWcuc3JjID0gaW1nVXJsO1xyXG5cclxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHJlcGxhY2U6IHRydWUsXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGNsYXNzPVwicG9zdGVyRWxlbVwiPjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJhbmd1bGFyLm1vZHVsZSggJ2FwcCcsIFtcclxuXHQndWkucm91dGVyJyxcclxuXHQnbmdBbmltYXRlJ1xyXG5dIClcclxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcclxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XHJcblx0a2V5OiAnMzc0YzAzNDJhNjQwNmRmZTBhZWIzZGUyZWEwNDJjNTknLFxyXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXHJcbn0gKVxyXG5cclxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vY29tbW9uL2xvZy5wdi5qcycgKSApXHJcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcclxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9jb21tb24vZXZlbnRzLmZhYy5qcycgKSApXHJcblxyXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtYWluQ3RybCcsIHJlcXVpcmUoICcuL21haW4uY3RybC5qcycgKSApXHJcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnaGVsaXgnLCByZXF1aXJlKCAnLi9oZWxpeC9oZWxpeC5mYWMuanMnICkgKVxyXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcclxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtb3ZpZURldGFpbEN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZURldGFpbC5jdHJsLmpzJyApIClcclxuXHJcbi5mYWN0b3J5KCAnYXV0aCcsIHJlcXVpcmUoICcuL2F1dGgvYXV0aC5mYWMuanMnICkgKVxyXG4uZmFjdG9yeSggJ2F1dGhUb2tlbicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aFRva2VuLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcclxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXHJcbi5jb250cm9sbGVyKCAnc2lnbmluQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbmluLmN0cmwuanMnICkgKVxyXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtb3ZpZUNvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzJyApIClcclxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcycgKSApXHJcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uTW9kYWwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcycgKSApXHJcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxyXG5cclxuLmRpcmVjdGl2ZSggJ2hvdmVyQ2xhc3MnLCByZXF1aXJlKCAnLi9kaXJlY3RpdmUvaG92ZXJDbGFzcy5kaXIuanMnICkgKVxyXG5cclxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL3JvdXRlQ29uZmlnLmpzJyApIClcclxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2xvZ0NvbmZpZy5qcycgKSApXHJcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9odHRwQ29uZmlnLmpzJyApIClcclxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBsb2csICRyb290U2NvcGUsICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkge1xyXG5cclxuXHRhdXRoLmF1dGhvcml6ZSggdHJ1ZSApO1xyXG5cclxuXHRtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcclxuXHJcblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xyXG5cclxuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7IC8vIHByZXZlbnQgdHJhbnNpdGlvblxyXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XHJcblx0XHRpZiAoIGVycm9yICkge1xyXG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XHJcblx0XHR9XHJcblxyXG5cdH0gKTtcclxuXHJcbn0gXSApXHJcbjtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJywgJyRzdGF0ZScsICckcm9vdFNjb3BlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgVE1EYiwgRVZULCBoZWxpeCwgRU5HSU5FLCBhdXRoLCAkc3RhdGUsICRyb290U2NvcGUgKSB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0uYXV0aCA9IGF1dGg7XHJcblx0dm0uc2VhcmNoID0ge1xyXG5cdFx0cXVlcnk6ICcnLFxyXG5cdH07XHJcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XHJcblxyXG5cdCRzY29wZS4kd2F0Y2goIFRNRGIuZ2V0UmVzLCBmdW5jdGlvbiAoIG1vdkl0ZW1zLCBvbGRNb3ZJdGVtcyApIHtcclxuXHJcblx0XHR2bS5tb3ZpZUl0ZW1zID0gbW92SXRlbXM7XHJcblx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBtb3ZJdGVtcy5zbGljZSggb2xkTW92SXRlbXMubGVuZ3RoICksIG9sZE1vdkl0ZW1zLmxlbmd0aCApO1xyXG5cclxuXHR9LCB0cnVlICk7XHJcblxyXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcclxuXHR2YXIgaGVsaXhOZWVkc1Jlc2V0ID0gZmFsc2U7XHJcblx0RVZULmhlbGl4TmVlZHNSZXNldC5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcclxuXHRcdGhlbGl4TmVlZHNSZXNldCA9IHRydWU7XHJcblx0fSApO1xyXG5cclxuXHR2bS5zZWFyY2ggPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XHJcblx0XHRpZiAoIHByZXZRdWVyeSAhPT0gdm0uc2VhcmNoLnF1ZXJ5IHx8IGhlbGl4TmVlZHNSZXNldCApIHtcclxuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xyXG5cdFx0XHRUTURiLmNsZWFyU2VhcmNoKCk7XHJcblx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XHJcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xyXG5cdFx0XHRoZWxpeE5lZWRzUmVzZXQgPSBmYWxzZTtcclxuXHRcdH1cclxuXHRcdGlmICggJHN0YXRlLmN1cnJlbnQubmFtZSAhPT0gJ2hlbGl4JyApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XHJcblx0XHR9XHJcblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xyXG5cdH07XHJcblxyXG5cdC8vIERFQlVHXHJcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xyXG5cdHZtLlRNRGIgPSBUTURiO1xyXG5cdHZtLmhlbGl4ID0gaGVsaXg7XHJcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xyXG5cdHZtLlNUQVRFID0gJHN0YXRlO1xyXG5cclxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdyZWNpZXZlZCBFT1AgZXZlbnQhJyApO1xyXG5cdH0gKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnVE1EYicsIGZ1bmN0aW9uICggbG9nLCBUTURiICkge1xyXG5cclxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRhdHRycywgJGVsZW1lbnQgKSB7XHJcblxyXG5cdFx0VE1EYi5zZWFyY2hCeUlkKCBwYXJzZUludCggJHNjb3BlLm1vdmllSWQgKSApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblxyXG5cdFx0XHQvLyBsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgcmVzICk7XHJcblx0XHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93OTIvJyArIHJlcy5wb3N0ZXJfcGF0aDtcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzEwMCUnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMTAwJScsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxMDAlIDEwMCUnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHJlc3RyaWN0OiAnRScsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0c2NvcGU6IHsgbW92aWVJZDogJ0AnIH0sXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2PjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdtb3ZpZUNvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQsICRhdHRycyApIHtcclxuXHJcblx0XHR2YXIgdm0gPSB0aGlzO1xyXG5cdFx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XHJcblxyXG5cdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cclxuXHRcdHZtLm9wZW5FZGl0b3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSB0cnVlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jbG9zZUVkaXRvciA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRpZiAoICRzY29wZS5uZXdDb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0XHRtb3ZpZUNvbGxlY3Rpb24uY3JlYXRlKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0XHQkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgPSAnJztcclxuXHRcdFx0XHR2bS5jbG9zZUVkaXRvcigpO1xyXG5cdFx0XHR9XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmFkZFRvQ29sbGVjdGlvbiA9IGZ1bmN0aW9uICggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnYWRkVG9Db2xsZWN0aW9uOicsIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdHZhciBzdWNjZXNzID0gbW92aWVDb2xsZWN0aW9uLnB1c2goIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnbW92aWVDb2xsZWN0aW9uLnB1c2gnLCBzdWNjZXNzICk7XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmNsb3NlTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcclxuXHRcdFx0JHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lID0gJyc7XHJcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuY2xvc2UoKTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHNjb3BlOiB7fSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCAnYXV0aCcsICckc3RhdGUnLCBmdW5jdGlvbiAoIGxvZywgRVZULCBhdXRoLCAkc3RhdGUgKSB7XHJcblxyXG5cdHZhciBhY3RpdmVJdGVtID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gc2V0QWN0aXZlSXRlbSggaXRlbSApIHtcclxuXHRcdGFjdGl2ZUl0ZW0gPSBpdGVtO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0QWN0aXZlSXRlbSggaXRlbSApIHtcclxuXHRcdHJldHVybiBhY3RpdmVJdGVtO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gb3BlbigpIHtcclxuXHRcdGlmICggYXV0aC5pc0F1dGhlbnRpY2F0ZWQoKSApIHtcclxuXHRcdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4uZW1pdCgpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UuZW1pdCgpO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNldEFjdGl2ZUl0ZW0sXHJcblx0XHRnZXRBY3RpdmVJdGVtLFxyXG5cdFx0b3BlbixcclxuXHRcdGNsb3NlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgJ1RNRGInLCAnaGVsaXgnLCAnRU5HSU5FJywgJyRzdGF0ZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24sIFRNRGIsIGhlbGl4LCBFTkdJTkUsICRzdGF0ZSwgRVZUICkgIHtcclxuXHJcblx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHJcblx0dm0udmlld0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoIGNvbGxlY3Rpb24gKSB7XHJcblxyXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd2aWV3Q29sbGVjdGlvbiA9PicsIGNvbGxlY3Rpb24gKTtcclxuXHJcblx0XHR2YXIgbG9hZGVkSXRlbXMgPSAwO1xyXG5cdFx0dmFyIHRvdGFsSXRlbXMgPSBjb2xsZWN0aW9uLm1vdmllcy5sZW5ndGg7XHJcblx0XHR2YXIgYWxsTW92aWVzID0gW107XHJcblxyXG5cdFx0Y29sbGVjdGlvbi5tb3ZpZXMuZm9yRWFjaCggZnVuY3Rpb24gKCBtb3ZpZUlkICkge1xyXG5cclxuXHRcdFx0VE1EYi5zZWFyY2hCeUlkKCBtb3ZpZUlkIClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRhbGxNb3ZpZXMucHVzaCggcmVzICk7XHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAndmlld0NvbGxlY3Rpb24gPT4nLCBlcnIgKTtcclxuXHRcdFx0XHR9IClcclxuXHRcdFx0XHQuZmluYWxseSggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0aWYgKCArK2xvYWRlZEl0ZW1zID09PSB0b3RhbEl0ZW1zICkge1xyXG5cclxuXHRcdFx0XHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcclxuXHRcdFx0XHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XHJcblx0XHRcdFx0XHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIGFsbE1vdmllcywgMCApO1xyXG5cdFx0XHRcdFx0XHQkc3RhdGUuZ28oICdoZWxpeCcgKTtcclxuXHRcdFx0XHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xyXG5cdFx0XHRcdFx0XHRFVlQuaGVsaXhOZWVkc1Jlc2V0LmVtaXQoKTtcclxuXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSApO1xyXG5cclxuXHRcdH0gKTtcclxuXHJcblxyXG5cdH07XHJcblxyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCBmdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEgKSB7XHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcclxuXHR2YXIgY29sbGVjdGlvbiA9IG51bGw7XHJcblxyXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIGNyZWF0ZSggbmFtZSApIHtcclxuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XHJcblx0XHRwdXQoKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGlzRW1wdHkoKSB7XHJcblx0XHRyZXR1cm4gY29sbGVjdGlvbi5sZW5ndGggPT09IDA7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZXNvbHZlQ29sbGVjdGlvbigpIHtcclxuXHJcblx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcclxuXHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggY29sbGVjdGlvbiApO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCByZXMgKTtcclxuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSByZXMuZGF0YTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcclxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgZXJyICk7XHJcblx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xyXG5cdFx0XHRcdH0gKTtcclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBoYXNJdGVtKCBpdGVtSWQsIHNvbWVDb2xsZWN0aW9uICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gc29tZUNvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0Zm9yICggdmFyIGsgPSAwOyBrIDwgY29sbGVjdGlvbltpXS5tb3ZpZXMubGVuZ3RoOyBrICsrICkge1xyXG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xyXG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHB1dCgpIHtcclxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQsIGNvbGxlY3Rpb24sIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgcmVzICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnB1dCgpOicsIGVyciApO1xyXG5cdFx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBwdXNoKCBpdGVtSWQsIHRvQ29sbGVjdGlvbiApIHtcclxuXHRcdGlmICggaGFzSXRlbSggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSApIHtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gdG9Db2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGNvbGxlY3Rpb25baV0ubW92aWVzLnB1c2goIGl0ZW1JZCApO1xyXG5cdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmUoIGl0ZW1JZCwgaW5Db2xsZWN0aW9uICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gaW5Db2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcclxuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcclxuXHRcdFx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uW2ldLm1vdmllcy5zcGxpY2UoIGssIDEgKS5sZW5ndGg7XHJcblx0XHRcdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZUNvbGxlY3Rpb24oIGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gY29sbGVjdGlvbk5hbWUgKSB7XHJcblx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uLnNwbGljZSggaSwgMSApLmxlbmd0aDtcclxuXHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc3luYygpIHtcclxuXHRcdC8vIHN5bmMgbG9jYWwgY29sZWxjdGlvbiB3LyBEQlxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0Q29sbGVjdGlvbigpIHtcclxuXHRcdHJldHVybiBjb2xsZWN0aW9uO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gX2NsZWFyKCkge1xyXG5cdFx0Y29sbGVjdGlvbiA9IG51bGw7XHJcblx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2xvY2FsIGNvbGxlY3Rpb24gY2xlYXJlZC4nICk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0Z2V0Q29sbGVjdGlvbixcclxuXHRcdGNyZWF0ZSxcclxuXHRcdHB1c2gsXHJcblx0XHRwdXQsXHJcblx0XHRyZW1vdmUsXHJcblx0XHRyZW1vdmVDb2xsZWN0aW9uLFxyXG5cdFx0c3luYyxcclxuXHRcdF9jbGVhcixcclxuXHRcdHJlc29sdmVDb2xsZWN0aW9uLFxyXG5cdFx0aGFzSXRlbSxcclxuXHRcdGlzRW1wdHlcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICckY2FjaGVGYWN0b3J5JywgJ21vdmllSXRlbScsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ21vdmllQ29sbGVjdGlvbicsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVJdGVtID0gbW92aWVJdGVtOyAvLyBtb3ZpZUl0ZW0gaW5qZWN0ZWQgdmlhIHN0YXRlIHJlc29sdmVcclxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XHJcblxyXG5cdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGU7XHJcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcclxuXHRcdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGUgKyAnICgnICsgbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICsgJyknO1xyXG5cdH1cclxuXHJcblx0aWYgKCBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aCApIHtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC9vcmlnaW5hbCcgKyBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aDtcclxuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XHJcblx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHR2bS5vcGVuQ29sbGVjdGlvbk1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCBtb3ZpZUl0ZW0gKTtcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uub3BlbigpO1xyXG5cdH07XHJcblxyXG59IF07XHJcbiJdfQ==
